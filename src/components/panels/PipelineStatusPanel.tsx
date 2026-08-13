import { useState, useEffect, useCallback, useRef } from 'react';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { createLazyClient, getRpcBaseUrl, rpcFetch } from '@/services/rpc-client';
import { attributionFooterHtml, ATTRIBUTION_FOOTER_CSS } from '@/utils/attribution-footer';

import type {
  ListPipelinesResponse,
  PipelineEntry,
  GetPipelineDetailResponse,
  ListEnergyDisruptionsResponse,
  EnergyDisruptionEntry,
} from '@/generated/client/worldmonitor/supply_chain/v1/service_client';
import { formatEventWindow, formatCapacityOffline } from '@/shared/disruption-timeline';
import {
  derivePipelinePublicBadge,
  pickNewerClassifierVersion,
  pickNewerIsoTimestamp,
} from '@/shared/pipeline-evidence';
import {
  getCachedPipelineRegistries,
  setCachedPipelineRegistries,
  type RawPipelineRegistry,
} from '@/shared/pipeline-registry-store';
import { SupplyChainServiceClient } from '@/services/generated-rpc-clients';
import { PanelShell } from '@/components/PanelShell';

const getSupplyChainClient = createLazyClient(() => new SupplyChainServiceClient(getRpcBaseUrl(), {
  fetch: rpcFetch,
}));

type RawBootstrapRegistry = RawPipelineRegistry;

const BADGE_COLOR: Record<string, string> = {
  flowing:  '#2ecc71',
  reduced:  '#f39c12',
  offline:  '#e74c3c',
  disputed: '#9b59b6',
};

function badgeLabel(badge: string): string {
  return badge.charAt(0).toUpperCase() + badge.slice(1);
}

function capacityLabel(p: PipelineEntry): string {
  if (p.commodityType === 'gas' && typeof p.capacityBcmYr === 'number' && p.capacityBcmYr > 0) {
    return `${p.capacityBcmYr.toFixed(1)} bcm/yr`;
  }
  if (p.commodityType === 'oil' && typeof p.capacityMbd === 'number' && p.capacityMbd > 0) {
    return `${p.capacityMbd.toFixed(2)} mb/d`;
  }
  return '—';
}

function badgeChip(badge: string | undefined): string {
  const safe = badge && BADGE_COLOR[badge] ? badge : 'disputed';
  const color = BADGE_COLOR[safe] ?? '#7f8c8d';
  return `<span class="pp-badge" style="background:${color}">${escapeHtml(badgeLabel(safe))}</span>`;
}

function projectRawPipeline(raw: unknown): PipelineEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  if (!id) return null;

  const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
  const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  const latLon = (v: unknown): { lat: number; lon: number } => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return { lat: num(o.lat), lon: num(o.lon) };
    }
    return { lat: 0, lon: 0 };
  };

  const evRaw = r.evidence as Record<string, unknown> | undefined;
  const operatorStatement =
    evRaw && typeof evRaw.operatorStatement === 'object' && evRaw.operatorStatement
      ? {
          text: str((evRaw.operatorStatement as Record<string, unknown>).text),
          url: str((evRaw.operatorStatement as Record<string, unknown>).url),
          date: str((evRaw.operatorStatement as Record<string, unknown>).date),
        }
      : undefined;
  const sanctionRefs = Array.isArray(evRaw?.sanctionRefs)
    ? (evRaw.sanctionRefs as unknown[]).map(s => {
        const o = (s ?? {}) as Record<string, unknown>;
        return { authority: str(o.authority), listId: str(o.listId), date: str(o.date), url: str(o.url) };
      })
    : [];

  const ev = evRaw
    ? {
        physicalState: str(evRaw.physicalState, 'unknown'),
        physicalStateSource: str(evRaw.physicalStateSource, 'operator'),
        operatorStatement,
        commercialState: str(evRaw.commercialState, 'unknown'),
        sanctionRefs,
        lastEvidenceUpdate: str(evRaw.lastEvidenceUpdate),
        classifierVersion: str(evRaw.classifierVersion, 'v1'),
        classifierConfidence: num(evRaw.classifierConfidence, 0),
      }
    : undefined;

  const publicBadge = derivePipelinePublicBadge(ev);

  return {
    id,
    name: str(r.name),
    operator: str(r.operator),
    commodityType: str(r.commodityType),
    fromCountry: str(r.fromCountry),
    toCountry: str(r.toCountry),
    transitCountries: Array.isArray(r.transitCountries)
      ? (r.transitCountries as unknown[]).map(t => str(t))
      : [],
    capacityBcmYr: num(r.capacityBcmYr),
    capacityMbd: num(r.capacityMbd),
    lengthKm: num(r.lengthKm),
    inService: num(r.inService),
    startPoint: latLon(r.startPoint),
    endPoint: latLon(r.endPoint),
    waypoints: Array.isArray(r.waypoints) ? (r.waypoints as unknown[]).map(latLon) : [],
    evidence: ev,
    publicBadge,
  };
}

function buildBootstrapResponse(
  gas: RawBootstrapRegistry | undefined,
  oil: RawBootstrapRegistry | undefined,
): ListPipelinesResponse | null {
  const pipelines: PipelineEntry[] = [];
  for (const reg of [gas, oil]) {
    if (!reg?.pipelines) continue;
    for (const raw of Object.values(reg.pipelines)) {
      const projected = projectRawPipeline(raw);
      if (projected) pipelines.push(projected);
    }
  }
  if (pipelines.length === 0) return null;
  return {
    pipelines,
    fetchedAt: pickNewerIsoTimestamp(gas?.updatedAt, oil?.updatedAt),
    classifierVersion: pickNewerClassifierVersion(gas?.classifierVersion, oil?.classifierVersion),
    upstreamUnavailable: false,
  };
}

function renderRow(p: PipelineEntry): string {
  const commodity = p.commodityType === 'gas' ? '⛽' : '🛢️';
  const route = `${escapeHtml(p.fromCountry)} → ${escapeHtml(p.toCountry)}`;
  return `
    <tr class="pp-row" data-pipeline-id="${escapeHtml(p.id)}">
      <td>
        <div class="pp-name">${commodity} ${escapeHtml(p.name)}</div>
        <div class="pp-sub">${escapeHtml(p.operator || '')}</div>
      </td>
      <td>${route}</td>
      <td>${escapeHtml(capacityLabel(p))}</td>
      <td>${badgeChip(p.publicBadge)}</td>
    </tr>`;
}

function renderDisruptionTimeline(detailEvents: EnergyDisruptionEntry[] | undefined): string {
  if (detailEvents === undefined) return '';
  if (detailEvents.length === 0) {
    return `<div class="pp-evidence">
      <div class="pp-sub" style="margin-bottom:6px">Disruption timeline</div>
      <div class="pp-ev-item pp-sub">No disruption events on file for this asset.</div>
    </div>`;
  }
  const items = detailEvents.map(ev => {
    const window = escapeHtml(formatEventWindow(ev.startAt, ev.endAt));
    const cap = formatCapacityOffline(ev.capacityOfflineBcmYr, ev.capacityOfflineMbd);
    const capLine = cap ? ` · ${escapeHtml(cap)} offline` : '';
    const causes = (ev.causeChain && ev.causeChain.length > 0)
      ? ` · ${escapeHtml(ev.causeChain.join(' → '))}`
      : '';
    return `<div class="pp-ev-item">
      <strong>${escapeHtml(ev.eventType || 'event')}</strong> · ${window}${capLine}${causes}
      <div class="pp-sub" style="margin-top:2px">${escapeHtml(ev.shortDescription || '')}</div>
    </div>`;
  }).join('');
  return `<div class="pp-evidence">
    <div class="pp-sub" style="margin-bottom:6px">Disruption timeline (${detailEvents.length})</div>
    ${items}
  </div>`;
}

function renderDrawer(
  detailLoading: boolean,
  detail: GetPipelineDetailResponse | null,
  detailEvents: EnergyDisruptionEntry[] | undefined,
): string {
  if (detailLoading) {
    return `<div class="pp-drawer"><button class="pp-drawer-close" aria-label="Close">✕</button>Loading…</div>`;
  }
  const p = detail?.pipeline;
  if (!p) {
    return `<div class="pp-drawer"><button class="pp-drawer-close" aria-label="Close">✕</button>Pipeline detail unavailable.</div>`;
  }

  const ev = p.evidence;
  const sanctionItems = (ev?.sanctionRefs ?? []).map(s => {
    const safeUrl = sanitizeUrl(s.url || '');
    const linkLabel = escapeHtml(s.date || 'source');
    const dateLink = safeUrl
      ? `<a href="${safeUrl}" target="_blank" rel="noopener">${linkLabel}</a>`
      : linkLabel;
    return `
    <div class="pp-ev-item">
      <strong>${escapeHtml(s.authority)}</strong> ${escapeHtml(s.listId || '')} ·
      ${dateLink}
    </div>`;
  }).join('');
  const operatorStatement = ev?.operatorStatement?.text
    ? (() => {
        const safeUrl = sanitizeUrl(ev.operatorStatement?.url || '');
        const dateLink = safeUrl
          ? `· <a href="${safeUrl}" target="_blank" rel="noopener">${escapeHtml(ev.operatorStatement?.date || 'source')}</a>`
          : '';
        return `<div class="pp-ev-item"><strong>Operator:</strong> ${escapeHtml(ev.operatorStatement.text)}
         ${dateLink}
       </div>`;
      })()
    : '';

  const transit = p.transitCountries.length > 0
    ? ` via ${p.transitCountries.map(c => escapeHtml(c)).join(', ')}`
    : '';

  return `
    <div class="pp-drawer">
      <button class="pp-drawer-close" aria-label="Close">✕</button>
      <h3>${escapeHtml(p.name)} ${badgeChip(p.publicBadge)}</h3>
      <div class="pp-kv">
        <div class="pp-kv-key">Operator</div>   <div>${escapeHtml(p.operator)}</div>
        <div class="pp-kv-key">Commodity</div>  <div>${escapeHtml(p.commodityType)}</div>
        <div class="pp-kv-key">Route</div>      <div>${escapeHtml(p.fromCountry)} → ${escapeHtml(p.toCountry)}${transit}</div>
        <div class="pp-kv-key">Capacity</div>   <div>${escapeHtml(capacityLabel(p))}</div>
        <div class="pp-kv-key">Length</div>     <div>${p.lengthKm > 0 ? `${p.lengthKm.toLocaleString()} km` : '—'}</div>
        <div class="pp-kv-key">In service</div> <div>${p.inService > 0 ? escapeHtml(String(p.inService)) : '—'}</div>
      </div>
      <div class="pp-evidence">
        <div class="pp-sub" style="margin-bottom:6px">Evidence</div>
        <div class="pp-ev-item">
          <strong>Physical state:</strong> ${escapeHtml(ev?.physicalState || 'unknown')}
          (source: ${escapeHtml(ev?.physicalStateSource || 'unknown')})
        </div>
        <div class="pp-ev-item"><strong>Commercial:</strong> ${escapeHtml(ev?.commercialState || 'unknown')}</div>
        ${operatorStatement}
        ${sanctionItems}
        ${ev?.classifierVersion ? `<div class="pp-ev-item pp-sub">Classifier ${escapeHtml(ev.classifierVersion)} · confidence ${Math.round((ev.classifierConfidence ?? 0) * 100)}%</div>` : ''}
      </div>
      ${renderDisruptionTimeline(detailEvents)}
    </div>`;
}

function buildHtml(
  data: ListPipelinesResponse,
  selectedId: string | null,
  detailLoading: boolean,
  detail: GetPipelineDetailResponse | null,
  detailEvents: EnergyDisruptionEntry[] | undefined,
): string {
  const rows = [...data.pipelines]
    .sort((a, b) => {
      const aFlow = a.publicBadge === 'flowing' ? 1 : 0;
      const bFlow = b.publicBadge === 'flowing' ? 1 : 0;
      if (aFlow !== bFlow) return aFlow - bFlow;
      if (a.commodityType !== b.commodityType) return a.commodityType.localeCompare(b.commodityType);
      return a.name.localeCompare(b.name);
    })
    .map(p => renderRow(p))
    .join('');

  const attribution = attributionFooterHtml({
    sourceType: 'classifier',
    method: 'evidence → badge (deterministic)',
    sampleSize: data.pipelines.length,
    sampleLabel: 'pipelines',
    updatedAt: data.fetchedAt,
    classifierVersion: data.classifierVersion,
    creditName: 'Global Energy Monitor (CC-BY 4.0)',
    creditUrl: 'https://globalenergymonitor.org/',
  });

  const drawer = selectedId ? renderDrawer(detailLoading, detail, detailEvents) : '';

  return `
    <div class="pp-wrap">
      <table class="pp-table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>From → To</th>
            <th>Capacity</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${attribution}
      ${drawer}
    </div>
    ${ATTRIBUTION_FOOTER_CSS}
    <style>
      .pp-wrap { position: relative; font-size: 11px; }
      .pp-table { width: 100%; border-collapse: collapse; }
      .pp-table th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim, #888); padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.08); }
      .pp-table td { padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.04); }
      .pp-table tr.pp-row { cursor: pointer; }
      .pp-table tr.pp-row:hover td { background: rgba(255,255,255,0.03); }
      .pp-name { font-weight: 600; color: var(--text, #eee); }
      .pp-sub  { font-size: 9px; color: var(--text-dim, #888); text-transform: uppercase; letter-spacing: 0.04em; }
      .pp-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 9px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.04em; }
      .pp-drawer { position: absolute; inset: 0; background: var(--panel-bg, #0f1218); padding: 12px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; }
      .pp-drawer-close { position: absolute; top: 8px; right: 10px; background: transparent; border: 0; color: var(--text-dim, #888); cursor: pointer; font-size: 14px; }
      .pp-drawer h3 { margin: 0 0 6px 0; font-size: 13px; color: var(--text, #eee); }
      .pp-drawer .pp-kv { display: grid; grid-template-columns: 120px 1fr; gap: 4px 10px; font-size: 10px; margin-bottom: 10px; }
      .pp-drawer .pp-kv-key { color: var(--text-dim, #888); text-transform: uppercase; letter-spacing: 0.04em; font-size: 9px; padding-top: 2px; }
      .pp-evidence { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); }
      .pp-ev-item { font-size: 10px; color: var(--text, #eee); margin-bottom: 6px; }
      .pp-ev-item a { color: #4ade80; text-decoration: none; }
      .pp-ev-item a:hover { text-decoration: underline; }
    </style>
  `;
}

export function PipelineStatusPanelContent() {
  const [data, setData] = useState<ListPipelinesResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GetPipelineDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEvents, setDetailEvents] = useState<EnergyDisruptionEntry[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const unmountedRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);

  const loadDetail = useCallback(async (pipelineId: string) => {
    setSelectedId(pipelineId);
    selectedIdRef.current = pipelineId;
    setDetailLoading(true);
    setDetailEvents(undefined);
    try {
      const [d, events] = await Promise.all([
        getSupplyChainClient().getPipelineDetail({ pipelineId }),
        getSupplyChainClient().listEnergyDisruptions({ assetId: pipelineId, assetType: 'pipeline', ongoingOnly: false }),
      ]);
      if (unmountedRef.current || selectedIdRef.current !== pipelineId) return;
      setDetail(d);
      setDetailEvents((events as ListEnergyDisruptionsResponse)?.events ?? []);
      setDetailLoading(false);
    } catch {
      if (unmountedRef.current || selectedIdRef.current !== pipelineId) return;
      setDetailLoading(false);
      setDetail(null);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    selectedIdRef.current = null;
    setDetail(null);
    setDetailEvents(undefined);
  }, []);

  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      const { gas, oil } = getCachedPipelineRegistries();
      const hydrated = buildBootstrapResponse(gas, oil);
      if (hydrated) {
        setData(hydrated);
        void getSupplyChainClient().listPipelines({ commodityType: '' }).then(live => {
          if (unmountedRef.current || !live?.pipelines?.length) return;
          setData(live);
          const toRecord = (filterCommodity: string): Record<string, PipelineEntry> =>
            Object.fromEntries(live.pipelines.filter(p => p.commodityType === filterCommodity).map(p => [p.id, p]));
          setCachedPipelineRegistries({
            gas: { pipelines: toRecord('gas'), classifierVersion: live.classifierVersion, updatedAt: live.fetchedAt },
            oil: { pipelines: toRecord('oil'), classifierVersion: live.classifierVersion, updatedAt: live.fetchedAt },
          });
        }).catch(() => {});
        return;
      }

      const live = await getSupplyChainClient().listPipelines({ commodityType: '' });
      if (unmountedRef.current) return;
      if (live.upstreamUnavailable || !live.pipelines?.length) {
        setLoadError('Pipeline registry unavailable');
        return;
      }
      setData(live);
      const toRecord = (filterCommodity: string): Record<string, PipelineEntry> =>
        Object.fromEntries(live.pipelines.filter(p => p.commodityType === filterCommodity).map(p => [p.id, p]));
      setCachedPipelineRegistries({
        gas: { pipelines: toRecord('gas'), classifierVersion: live.classifierVersion, updatedAt: live.fetchedAt },
        oil: { pipelines: toRecord('oil'), classifierVersion: live.classifierVersion, updatedAt: live.fetchedAt },
      });
    } catch {
      if (unmountedRef.current) return;
      setLoadError('Pipeline registry error');
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    void loadData();
    return () => { unmountedRef.current = true; };
  }, [loadData]);

  useEffect(() => {
    const handler = (ev: Event) => {
      const id = (ev as CustomEvent<{ pipelineId?: string }>).detail?.pipelineId;
      if (id) void loadDetail(id);
    };
    window.addEventListener('energy:open-pipeline-detail', handler);
    return () => window.removeEventListener('energy:open-pipeline-detail', handler);
  }, [loadDetail]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.pp-drawer-close')) {
      closeDetail();
      return;
    }
    const row = target.closest<HTMLTableRowElement>('tr.pp-row');
    if (row?.dataset.pipelineId) {
      void loadDetail(row.dataset.pipelineId);
    }
  }, [loadDetail, closeDetail]);

  if (!data && !loadError) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
      </div>
    );
  }

  if (!data && loadError) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{loadError}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={() => void loadData()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: buildHtml(data!, selectedId, detailLoading, detail, detailEvents) }}
      onClick={handleClick}
    />
  );
}

export function PipelineStatusPanel() {
  return (
    <PanelShell
      id="pipeline-status"
      title="Pipeline Status Register"
      infoTooltip="Classifier-derived badge (flowing / reduced / offline / disputed) for every tracked oil & gas pipeline. Evidence sources: operator statements, sanction registries, physical-state signals. See /docs/methodology/pipelines for the threshold spec + classifier version."
      defaultRowSpan={2}
    >
      <PipelineStatusPanelContent />
    </PanelShell>
  );
}
