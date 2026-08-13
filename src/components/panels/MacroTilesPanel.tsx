import { useState, useCallback, type KeyboardEvent } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { getHydratedData } from '@/services/bootstrap';
import { getEurostatCountryData } from '@/services/economic';
import type { GetEurostatCountryDataResponse } from '@/services/economic';
import type {
  ChinaMacroIndicator,
  GetChinaMacroSnapshotResponse,
} from '@/generated/client/worldmonitor/economic/v1/service_client';
import {
  hasChinaMacroData,
  isChinaLaunchReady,
  normalizeHydratedChina,
} from '@/components/macro-tiles-china';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'us' | 'eu' | 'cn';

interface MacroTile {
  id: string;
  label: string;
  value: number | null;
  prior: number | null;
  date: string;
  lowerIsBetter: boolean;
  neutral?: boolean;
  format: (v: number) => string;
  deltaFormat?: (v: number) => string;
}

export interface MacroTilesData {
  usTiles: MacroTile[];
  eurostat: GetEurostatCountryDataResponse | null;
  estrObs: { date: string; value: number }[];
  china: GetChinaMacroSnapshotResponse | null;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function pctFmt(v: number): string { return `${v.toFixed(1)}%`; }
function gdpFmt(v: number): string { return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}B`; }

function cpiYoY(obs: { date: string; value: number }[]): { value: number | null; prior: number | null; date: string } {
  if (obs.length < 13) return { value: null, prior: null, date: '' };
  const latest = obs[obs.length - 1];
  const yearAgo = obs[obs.length - 13];
  const priorMonth = obs[obs.length - 2];
  const priorYearAgo = obs[obs.length - 14] ?? obs[obs.length - 13];
  if (!latest || !yearAgo) return { value: null, prior: null, date: '' };
  const yoy = yearAgo.value > 0 ? ((latest.value - yearAgo.value) / yearAgo.value) * 100 : null;
  const priorYoy = (priorYearAgo && priorMonth && priorYearAgo.value > 0)
    ? ((priorMonth.value - priorYearAgo.value) / priorYearAgo.value) * 100 : null;
  return { value: yoy, prior: priorYoy, date: latest.date };
}

function lastTwo(obs: { date: string; value: number }[]): { value: number | null; prior: number | null; date: string } {
  const last = obs[obs.length - 1];
  if (!obs.length || !last) return { value: null, prior: null, date: '' };
  return { value: last.value, prior: obs[obs.length - 2]?.value ?? null, date: last.date };
}

function deltaColor(delta: number, lowerIsBetter: boolean, neutral: boolean): string {
  if (neutral || delta === 0) return 'var(--text-dim)';
  return (lowerIsBetter ? delta < 0 : delta > 0) ? '#27ae60' : '#e74c3c';
}

function fmtEuDate(d: string): string {
  const parts = /^(\d{4})-(\d{2})$/.exec(d);
  if (parts) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[parseInt(parts[2] ?? '0', 10) - 1];
    return mon ? `${mon} ${parts[1] ?? d}` : d;
  }
  return d;
}

const EU_CORE = ['DE', 'FR', 'IT', 'ES'];

function euAvg(
  eurostat: GetEurostatCountryDataResponse,
  key: 'cpi' | 'unemployment' | 'gdpGrowth',
): { value: number | null; prior: number | null; date: string } {
  const values: number[] = [], priorValues: number[] = [];
  let latestDate = '';
  for (const code of EU_CORE) {
    const m = eurostat.countries[code]?.[key];
    if (m && typeof m.value === 'number' && Number.isFinite(m.value)) {
      values.push(m.value);
      if (!latestDate || m.date > latestDate) latestDate = m.date;
    }
    if (m?.hasPrior && Number.isFinite(m.priorValue)) priorValues.push(m.priorValue);
  }
  if (values.length === 0) return { value: null, prior: null, date: '' };
  const avg = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
  const priorAvg = priorValues.length === values.length
    ? Math.round((priorValues.reduce((s, v) => s + v, 0) / priorValues.length) * 100) / 100
    : null;
  return { value: avg, prior: priorAvg, date: fmtEuDate(latestDate) };
}

function chinaValueFmt(indicator: ChinaMacroIndicator, value: number): string {
  if (indicator.unit === '%') return `${value.toFixed(1)}%`;
  if (indicator.unit === 'index') return value.toFixed(2);
  if (indicator.unit.includes('per')) return value.toFixed(4);
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${indicator.unit ? ` ${indicator.unit}` : ''}`;
}

async function fetchMacroTilesData(_signal: AbortSignal): Promise<MacroTilesData> {
  const { EconomicServiceClient } = await import('@/generated/client/worldmonitor/economic/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new EconomicServiceClient(getRpcBaseUrl(), { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });

  const hydratedChina = normalizeHydratedChina(
    getHydratedData('chinaMacro'),
    getHydratedData('chinaReleaseCalendar'),
  );

  const [fredResp, eurostatResp, chinaResp] = await Promise.allSettled([
    client.getFredSeriesBatch({ seriesIds: ['CPIAUCSL', 'UNRATE', 'GDP', 'FEDFUNDS', 'ESTR'], limit: 14 }),
    getEurostatCountryData(),
    hydratedChina ?? client.getChinaMacroSnapshot({}),
  ]);

  const results = fredResp.status === 'fulfilled' ? (fredResp.value.results ?? {}) : {};
  const estrObs = results['ESTR']?.observations ?? [];
  const eurostat = (eurostatResp.status === 'fulfilled' && !eurostatResp.value.unavailable) ? eurostatResp.value : null;
  const china = chinaResp.status === 'fulfilled' ? chinaResp.value : null;

  const cpi    = cpiYoY(results['CPIAUCSL']?.observations ?? []);
  const unrate = lastTwo(results['UNRATE']?.observations ?? []);
  const gdp    = lastTwo(results['GDP']?.observations ?? []);
  const fed    = lastTwo(results['FEDFUNDS']?.observations ?? []);

  const usTiles: MacroTile[] = [
    { id: 'cpi',    label: 'CPI (YoY)',       ...cpi,    lowerIsBetter: true,  format: pctFmt, deltaFormat: (v) => v.toFixed(2) },
    { id: 'unrate', label: 'Unemployment',    ...unrate, lowerIsBetter: true,  format: pctFmt },
    { id: 'gdp',    label: 'GDP (Billions)',  ...gdp,    lowerIsBetter: false, format: gdpFmt, deltaFormat: (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}B` },
    { id: 'fed',    label: 'Fed Funds Rate',  ...fed,    lowerIsBetter: false, neutral: true,  format: pctFmt },
  ];

  const hasUs    = usTiles.some(t => t.value !== null);
  const hasEu    = eurostat !== null;
  const hasChina = hasChinaMacroData(china);

  if (!hasUs && !hasEu && !hasChina) throw new Error('Macro data unavailable');

  return { usTiles, eurostat, estrObs, china };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MacroTileCard({ tile }: { tile: MacroTile }) {
  const val = tile.value !== null ? tile.format(tile.value) : 'N/A';
  const delta = tile.value !== null && tile.prior !== null ? tile.value - tile.prior : null;
  const fmt = tile.deltaFormat ?? tile.format;
  const deltaStr = delta !== null ? `${delta >= 0 ? '+' : ''}${fmt(delta)} vs prior` : '';
  const color = delta !== null ? deltaColor(delta, tile.lowerIsBetter, tile.neutral ?? false) : 'var(--text-dim)';
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{tile.label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
      {deltaStr && <div style={{ fontSize: 11, color }}>{deltaStr}</div>}
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{tile.date}</div>
    </div>
  );
}

function ChinaTileCard({ indicator }: { indicator: ChinaMacroIndicator }) {
  const available = indicator.hasValue && Number.isFinite(indicator.value);
  const value = available ? chinaValueFmt(indicator, indicator.value) : 'N/A';
  const transportProblem = indicator.transportStatus && indicator.transportStatus !== 'fresh'
    ? `TRANSPORT_${indicator.transportStatus.toUpperCase()}` : '';
  const direction = indicator.direction && indicator.direction !== 'unavailable' ? indicator.direction : '';
  const state = indicator.stale ? 'STALE'
    : (indicator.unavailableReason || indicator.transportFailureReason || transportProblem || direction || (available ? 'LIVE' : 'UNAVAILABLE'));
  const stateColor = indicator.stale ? '#f39c12'
    : (indicator.unavailableReason || indicator.transportFailureReason || transportProblem || !available || indicator.direction === 'weakening'
      ? '#e74c3c'
      : indicator.direction === 'unchanged' ? 'var(--text-dim)' : '#27ae60');
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{indicator.label}</div>
        <span style={{ fontSize: 9, color: stateColor, fontWeight: 600 }}>{state.replace(/_/g, ' ')}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Period {indicator.observationPeriod} · {(indicator.periodKind || 'period unknown').replace(/_/g, ' ')}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Released {indicator.releaseTime || 'n/a'} · {(indicator.revisionState || 'n/a').replace(/_/g, ' ')}</div>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>Source: {indicator.source || 'n/a'}</div>
    </div>
  );
}

function TileGrid({ tiles }: { tiles: MacroTile[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
      {tiles.map(tile => <MacroTileCard key={tile.id} tile={tile} />)}
    </div>
  );
}

function EUBody({ eurostat, estrObs }: { eurostat: GetEurostatCountryDataResponse; estrObs: { date: string; value: number }[] }) {
  const cpiAvg = euAvg(eurostat, 'cpi');
  const unAvg  = euAvg(eurostat, 'unemployment');
  const gdpAvg = euAvg(eurostat, 'gdpGrowth');
  const estr   = lastTwo(estrObs);
  const euTiles: MacroTile[] = [
    { id: 'eu-cpi',  label: 'HICP (YoY)',        value: cpiAvg.value, prior: cpiAvg.prior, date: cpiAvg.date, lowerIsBetter: true,  format: pctFmt },
    { id: 'eu-un',   label: 'Unemployment',       value: unAvg.value,  prior: unAvg.prior,  date: unAvg.date,  lowerIsBetter: true,  format: pctFmt },
    { id: 'eu-gdp',  label: 'GDP Growth (QoQ)',   value: gdpAvg.value, prior: gdpAvg.prior, date: gdpAvg.date, lowerIsBetter: false, format: pctFmt },
    { id: 'eu-estr', label: '€STR (ECB Rate)',    ...estr,             lowerIsBetter: false, neutral: true,   format: pctFmt },
  ];
  if (!euTiles.some(t => t.value !== null)) {
    return <div style={{ padding: 8, color: 'var(--text-dim)', fontSize: 12 }}>Euro Area data unavailable</div>;
  }
  return (
    <>
      <TileGrid tiles={euTiles} />
      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text-dim)' }}>Eurostat · ECB · avg DE, FR, IT, ES</div>
    </>
  );
}

function ChinaBody({ china }: { china: GetChinaMacroSnapshotResponse }) {
  const today = new Date().toISOString().slice(0, 10);
  const upcomingEvents = china.releaseEvents
    .filter(e => e.countryCode === 'CN' && e.releaseDate >= today)
    .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
    .slice(0, 3);
  return (
    <>
      {!isChinaLaunchReady(china) && (
        <div style={{ marginBottom: 8, padding: '7px 9px', border: '1px solid #f39c12', borderRadius: 5, color: '#f39c12', fontSize: 10 }}>
          Official China macro pulse is degraded; stale or delayed observations remain visible below.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
        {china.indicators.map(ind => <ChinaTileCard key={ind.id} indicator={ind} />)}
      </div>
      {upcomingEvents.length > 0 ? (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>China release calendar</div>
          {upcomingEvents.map((ev, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
              <span>{ev.event}</span>
              <span>{ev.releaseDate} · {ev.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)' }}>China release calendar unavailable</div>
      )}
    </>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

const TAB_LABELS: Record<Tab, string> = { us: 'US', eu: 'Euro Area', cn: 'China' };

/** Content-only component — rendered inside Panel base class's content div. */
export function MacroTilesPanelContent() {
  const { data, loading, error, refetch } = usePanelData<MacroTilesData>(fetchMacroTilesData, {
    ttlMs: 10 * 60 * 1000,
  });

  const hasChina = hasChinaMacroData(data?.china ?? null);
  const availableTabs: Tab[] = hasChina ? ['us', 'eu', 'cn'] : ['us', 'eu'];

  const [tab, setTab] = useState<Tab>('us');
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0]!;

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"][data-tab]');
    if (!btn || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const current = availableTabs.indexOf(btn.dataset.tab as Tab);
    if (current < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? availableTabs[0]
      : e.key === 'End' ? availableTabs[availableTabs.length - 1]
      : availableTabs[(current + (e.key === 'ArrowRight' ? 1 : -1) + availableTabs.length) % availableTabs.length];
    if (next) {
      setTab(next);
      setTimeout(() => (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus(), 0);
    }
  }, [availableTabs]);

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">Loading…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.noDataShort')}</div>
        <button className="panel-error-retry" data-panel-retry onClick={refetch}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Tab bar */}
      <div role="tablist" aria-label="Macro economy" style={{ display: 'flex', gap: 4, marginBottom: 10, overflowX: 'auto' }} onKeyDown={handleKeyDown}>
        {availableTabs.map(tabId => (
          <button
            key={tabId}
            id={`macro-tiles-tab-${tabId}`}
            role="tab"
            aria-selected={activeTab === tabId}
            aria-controls="macro-tiles-tabpanel"
            tabIndex={activeTab === tabId ? 0 : -1}
            className={`panel-tab${activeTab === tabId ? ' active' : ''}`}
            data-tab={tabId}
            style={{ fontSize: 11, padding: '6px 10px', minHeight: 44 }}
            onClick={() => setTab(tabId)}
          >
            {TAB_LABELS[tabId]}
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <div id="macro-tiles-tabpanel" role="tabpanel" aria-labelledby={`macro-tiles-tab-${activeTab}`}>
        {activeTab === 'us' && <TileGrid tiles={data.usTiles} />}
        {activeTab === 'eu' && (
          data.eurostat
            ? <EUBody eurostat={data.eurostat} estrObs={data.estrObs} />
            : <div style={{ padding: 8, color: 'var(--text-dim)', fontSize: 12 }}>Euro Area data unavailable</div>
        )}
        {activeTab === 'cn' && (
          data.china && hasChinaMacroData(data.china)
            ? <ChinaBody china={data.china} />
            : <div style={{ padding: 8, color: 'var(--text-dim)', fontSize: 12 }}>China macro data unavailable</div>
        )}
      </div>
    </div>
  );
}

export function MacroTilesPanel() {
  return (
    <PanelShell
      id="macro-tiles"
      title="Macro Indicators"
      infoTooltip={t('components.macroTiles.infoTooltip')}
    >
      <MacroTilesPanelContent />
    </PanelShell>
  );
}
