import { useState, useEffect, useRef } from 'react';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import { premiumFetch } from '@/services/premium-fetch';
import { IS_EMBEDDED_PREVIEW } from '@/utils/embedded-preview';
import { hasPremiumAccess, getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';
import { PanelShell } from '@/components/PanelShell';
import { onEntitlementChange } from '@/services/entitlements';
import { escapeHtml } from '@/utils/sanitize';
import {
  BOARD_REGIONS,
  DEFAULT_REGION_ID,
  buildBoardHtml,
  buildRegimeHistoryBlock,
  buildWeeklyBriefBlock,
  isLatestSequence,
} from '@/components/regional-intelligence-board-utils';
import type {
  RegionalSnapshot,
  RegimeTransition,
  RegionalBrief,
} from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import { IntelligenceServiceClient } from '@/services/generated-rpc-clients';

const getIntelligenceClient = createLazyClient(
  () => new IntelligenceServiceClient(getRpcBaseUrl(), { fetch: premiumFetch }),
);

const FALLBACK_TIMEOUT_MS = 4000;

type RibState =
  | { type: 'loading' }
  | { type: 'empty'; message: string }
  | { type: 'error'; message: string }
  | { type: 'board'; html: string };

function buildFallbackNotice(requestedId: string, actualId: string): string {
  const requestedLabel = BOARD_REGIONS.find(r => r.id === requestedId)?.label ?? requestedId;
  const actualLabel = BOARD_REGIONS.find(r => r.id === actualId)?.label ?? actualId;
  return `<div class="rib-fallback-notice" style="padding:10px 16px;margin:0 0 8px;background:var(--bg-elevated,rgba(255,255,255,0.04));border-left:3px solid var(--warning,#d4a015);font-size:12px;color:var(--text-dim);line-height:1.5">${escapeHtml(requestedLabel)} is being refreshed — showing ${escapeHtml(actualLabel)} in the meantime.</div>`;
}

export function RegionalIntelligencePanelContent() {
  const [region, setRegion] = useState(DEFAULT_REGION_ID);
  const [state, setState] = useState<RibState>({ type: 'loading' });
  const sequenceRef = useRef(0);
  const regionRef = useRef(DEFAULT_REGION_ID);
  const lastHadPremiumRef = useRef(hasPremiumAccess());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  async function doLoad(regionId: string) {
    if (!mountedRef.current) return;

    if (IS_EMBEDDED_PREVIEW || !hasPremiumAccess()) {
      setState({ type: 'empty', message: 'Regional intelligence is being refreshed. Try selecting another region above.' });
      return;
    }

    sequenceRef.current++;
    const mySeq = sequenceRef.current;
    setState({ type: 'loading' });

    let snapshot: RegionalSnapshot | undefined;
    let actualRegion = regionId;
    let fallbackFrom: string | null = null;

    try {
      const resp = await getIntelligenceClient().getRegionalSnapshot({ regionId });
      if (!mountedRef.current || !isLatestSequence(mySeq, sequenceRef.current)) return;
      snapshot = resp.snapshot;
    } catch (err) {
      if (!mountedRef.current || !isLatestSequence(mySeq, sequenceRef.current)) return;
      setState({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Fallback: race other regions if requested one has no data
    if (!snapshot?.regionId) {
      const fallbackIds = BOARD_REGIONS.map(r => r.id).filter(id => id !== regionId);
      const winner = await new Promise<{ snapshot: RegionalSnapshot; id: string } | null>(resolve => {
        if (fallbackIds.length === 0) { resolve(null); return; }
        let resolved = false;
        let pending = fallbackIds.length;
        const settle = (v: { snapshot: RegionalSnapshot; id: string } | null) => {
          if (resolved) return;
          resolved = true;
          resolve(v);
        };
        const timer = setTimeout(() => settle(null), FALLBACK_TIMEOUT_MS);
        for (const id of fallbackIds) {
          getIntelligenceClient().getRegionalSnapshot({ regionId: id })
            .then(resp => {
              if (resp.snapshot?.regionId) { clearTimeout(timer); settle({ snapshot: resp.snapshot, id }); return; }
              if (--pending === 0) { clearTimeout(timer); settle(null); }
            })
            .catch(() => { if (--pending === 0) { clearTimeout(timer); settle(null); } });
        }
      });
      if (!mountedRef.current || !isLatestSequence(mySeq, sequenceRef.current)) return;
      if (winner) { snapshot = winner.snapshot; actualRegion = winner.id; fallbackFrom = regionId; }
    }

    if (!snapshot?.regionId) {
      setState({ type: 'empty', message: 'Regional intelligence is being refreshed. Try selecting another region above.' });
      return;
    }

    // Phase 1 render: board without enrichments
    const notice = fallbackFrom ? buildFallbackNotice(fallbackFrom, snapshot.regionId) : '';
    setState({ type: 'board', html: notice + buildBoardHtml(snapshot) });

    // Phase 2: history + brief in background
    const historyP = getIntelligenceClient().getRegimeHistory({ regionId: actualRegion, limit: 20 }).catch(() => null);
    const briefP = getIntelligenceClient().getRegionalBrief({ regionId: actualRegion }).catch(() => null);

    void Promise.allSettled([historyP, briefP]).then(([hResult, bResult]) => {
      if (!mountedRef.current || !isLatestSequence(mySeq, sequenceRef.current)) return;

      const hValue = hResult.status === 'fulfilled' ? hResult.value : null;
      const transitions: RegimeTransition[] | null =
        hValue && !(hValue as unknown as { upstreamUnavailable?: boolean }).upstreamUnavailable
          ? (hValue.transitions ?? [])
          : null;

      const bValue = bResult.status === 'fulfilled' ? bResult.value : null;
      const brief: RegionalBrief | undefined | null =
        bValue && !(bValue as unknown as { upstreamUnavailable?: boolean }).upstreamUnavailable
          ? bValue.brief
          : null;

      let html = notice + buildBoardHtml(snapshot!);
      if (transitions !== null && transitions !== undefined) html += buildRegimeHistoryBlock(transitions);
      if (brief !== null) html += buildWeeklyBriefBlock(brief);
      setState({ type: 'board', html });
    });
  }

  useEffect(() => {
    regionRef.current = region;
    void doLoad(region);
  }, [region]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handle = () => {
      const hasPremium = hasPremiumAccess();
      if (hasPremium && !lastHadPremiumRef.current) {
        lastHadPremiumRef.current = true;
        void doLoad(regionRef.current);
      } else if (!hasPremium && lastHadPremiumRef.current) {
        lastHadPremiumRef.current = false;
        sequenceRef.current++;
        setState({ type: 'empty', message: 'Regional intelligence is being refreshed. Try selecting another region above.' });
      }
    };
    const unsub1 = subscribeAuthState(handle);
    const unsub2 = onEntitlementChange(handle);
    return () => { unsub1(); unsub2(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rib-shell">
      <div className="rib-controls">
        <select
          className="rib-region-selector"
          aria-label="Region"
          value={region}
          onChange={e => setRegion(e.target.value)}
        >
          {BOARD_REGIONS.map(r => (
            <option key={r.id} value={r.id}>{r.label}</option>
          ))}
        </select>
      </div>
      <div className="rib-body">
        {state.type === 'loading' && (
          <div className="rib-status" style={{ padding: '16px', color: 'var(--text-dim)', fontSize: '12px' }}>
            Loading regional intelligence…
          </div>
        )}
        {state.type === 'empty' && (
          <div className="rib-status" style={{ padding: '16px', color: 'var(--text-dim)', fontSize: '12px' }}>
            {state.message}
          </div>
        )}
        {state.type === 'error' && (
          <div className="rib-status rib-status-error" style={{ padding: '16px', color: 'var(--danger)', fontSize: '12px' }}>
            We couldn&#39;t load this region right now: {state.message}
          </div>
        )}
        {state.type === 'board' && (
          <div dangerouslySetInnerHTML={{ __html: state.html }} />
        )}
      </div>
    </div>
  );
}

function usePremiumGate() {
  const [authState, setAuthState] = useState(getAuthState);
  useEffect(() => subscribeAuthState(setAuthState), []);
  let reason = getPanelGateReason(authState, true);
  if (reason === PanelGateReason.FREE_TIER) reason = resolveBillingAwareGateReason(reason);
  return {
    locked: reason !== PanelGateReason.NONE,
    onLockedCtaClick: () => resolveGateAction(reason, { openAuthModal: openSignIn })(),
  };
}

export function RegionalIntelligencePanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="regional-intelligence"
      title="Regional Intelligence"
      infoTooltip="Canonical regional intelligence brief: regime label, 7-axis balance vector, top actors, scenario lanes, transmission paths, and watchlist. One snapshot per region, refreshed every 6 hours."
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
    >
      <RegionalIntelligencePanelContent />
    </PanelShell>
  );
}
