import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchChinaCorridorControlTowers,
  type ChinaCorridorCondition,
  type ChinaCorridorControlTowerResponse,
  type CorridorAvailability,
  type CorridorSourceSignal,
} from '@/services/supply-chain';
import {
  CHINA_CORRIDOR_SIGNAL_FAMILIES,
  type ChinaCorridorSignalFamily,
  type ChinaLogisticsCorridorId,
} from '../../../shared/china-logistics-corridors';
import { sanitizeUrl } from '@/utils/sanitize';
import { getRendererCapability, subscribeRendererCapability } from '@/services/china-corridor-store';
import { PanelShell } from '@/components/PanelShell';

const FAMILY_LABELS: Record<ChinaCorridorSignalFamily, string> = {
  port: 'Ports',
  aviation: 'Aviation',
  hazard: 'Hazards',
  power_energy: 'Power / energy',
  strategic_industry: 'Strategic industry',
  trade: 'Trade',
};

const AVAILABILITY_LABELS: Record<CorridorAvailability, string> = {
  available: 'Available',
  partial: 'Partial',
  stale: 'Stale',
  unavailable: 'Unavailable',
};

const RENDERER_HINT =
  'The active map renderer centers this corridor but cannot draw its boundary or nodes. Use the WebGL 2D map on a supported device to view the overlay.';

function formatDate(
  value: string | null,
  precision: CorridorSourceSignal['observationTimePrecision'],
): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  const date = new Date(value);
  if (precision === 'year') return String(date.getUTCFullYear());
  if (precision === 'month') {
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  if (precision === 'day') {
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  });
}

function SignalItem({ signal }: { signal: CorridorSourceSignal }) {
  const sourceUrl = signal.sourceUrl ? sanitizeUrl(signal.sourceUrl) : '';
  return (
    <li className="china-corridor-source" data-source-availability={signal.availability}>
      <div className="china-corridor-source__summary">{signal.summary}</div>
      <div className="china-corridor-source__meta">
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{signal.publisher.name}</a>
        ) : (
          <span>{signal.publisher.name}</span>
        )}
        <span>source {signal.availability}</span>
        <span>observed {formatDate(signal.observationTime, signal.observationTimePrecision)} ({signal.observationTimePrecision})</span>
        <span>released {formatDate(signal.releaseTime, signal.releaseTimePrecision)} ({signal.releaseTimePrecision})</span>
        <span>retrieved {formatDate(signal.retrievalTime, signal.retrievalTimePrecision)} ({signal.retrievalTimePrecision})</span>
        <span>transport {signal.transportFreshness}</span>
        <span>content {signal.contentFreshness}</span>
        <span>revision {signal.revision?.state ?? 'unknown'}</span>
      </div>
    </li>
  );
}

function ConditionCard({ condition }: { condition: ChinaCorridorCondition }) {
  return (
    <article
      className="china-corridor-condition"
      data-family={condition.family}
      data-availability={condition.availability}
    >
      <header>
        <h4>{FAMILY_LABELS[condition.family]}</h4>
        <span className={`china-corridor-status china-corridor-status--${condition.availability}`}>
          {AVAILABILITY_LABELS[condition.availability]}
        </span>
      </header>
      <div className="china-corridor-provider">Provider family: {condition.providerId}</div>
      {condition.sourceSignals.length > 0 ? (
        <ul className="china-corridor-sources">
          {condition.sourceSignals.map((s, i) => <SignalItem key={i} signal={s} />)}
        </ul>
      ) : (
        <p className="china-corridor-missing">
          {condition.reason ?? 'No reviewed source signal is available.'}
        </p>
      )}
    </article>
  );
}

export function ChinaCorridorPanelContent() {
  const [response, setResponse] = useState<ChinaCorridorControlTowerResponse | null>(null);
  const [selectedId, setSelectedId] = useState<ChinaLogisticsCorridorId | null>(null);
  const [selectedFamilies, setSelectedFamilies] = useState<Set<ChinaCorridorSignalFamily>>(
    new Set(CHINA_CORRIDOR_SIGNAL_FAMILIES),
  );
  const [showRendererHint, setShowRendererHint] = useState(() => {
    const cap = getRendererCapability();
    return cap === false;
  });
  const [loading, setLoading] = useState(true);
  const [error, setErrorState] = useState<{ msg: string; retry: () => void } | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const abortRef = useRef(new AbortController());

  useEffect(() => () => { abortRef.current.abort(); }, []);

  useEffect(() => subscribeRendererCapability(supported => setShowRendererHint(!supported)), []);

  const doFetch = useCallback(async () => {
    setLoading(true);
    setErrorState(null);
    try {
      const resp = await fetchChinaCorridorControlTowers();
      if (abortRef.current.signal.aborted) return;
      if (resp.corridors.length === 0) {
        setLoading(false);
        setErrorState({ msg: 'China corridor data unavailable', retry: doFetch });
        return;
      }
      setResponse(resp);
      setSelectedId(id => id ?? (resp.corridors[0]?.id ?? null));
      setLoading(false);
    } catch {
      if (abortRef.current.signal.aborted) return;
      setLoading(false);
      setErrorState({ msg: 'China corridor data unavailable', retry: doFetch });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void doFetch(); }, [doFetch]);

  const selectCorridor = useCallback((id: string, focus = false) => {
    if (!response) return;
    const corridor = response.corridors.find(c => c.id === id);
    if (!corridor) return;
    setSelectedId(corridor.id);
    window.dispatchEvent(new CustomEvent('wm:corridor-select', { detail: { corridor } }));
    if (focus) {
      requestAnimationFrame(() => {
        tabRefs.current.get(corridor.id)?.focus();
      });
    }
  }, [response]);

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>, corridorId: string) => {
    if (!response || !['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    const ids = response.corridors.map(c => c.id);
    const current = ids.indexOf(corridorId as ChinaLogisticsCorridorId);
    if (current < 0) return;
    e.preventDefault();
    let next: ChinaLogisticsCorridorId | undefined;
    if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    else {
      const offset = e.key === 'ArrowRight' ? 1 : -1;
      next = ids[(current + offset + ids.length) % ids.length];
    }
    if (next) selectCorridor(next, true);
  }, [response, selectCorridor]);

  if (loading) return <div className="panel-loading">Loading corridor data…</div>;
  if (error) {
    return (
      <div className="panel-error">
        <p>{error.msg}</p>
        <button onClick={error.retry}>Retry</button>
      </div>
    );
  }
  if (!response) return null;

  const selected = response.corridors.find(c => c.id === selectedId) ?? response.corridors[0];
  if (!selected) return <div className="panel-empty">No corridor data available.</div>;

  const filteredConditions = selected.conditions.filter(c => selectedFamilies.has(c.family));

  return (
    <div className="china-corridor-panel">
      <div
        className="china-corridor-compare"
        role="tablist"
        aria-label="Compare China logistics corridors"
      >
        {response.corridors.map(corridor => {
          const available = corridor.conditions.filter(c => c.availability === 'available').length;
          const isSelected = corridor.id === selected.id;
          return (
            <button
              key={corridor.id}
              id={`china-corridor-tab-${corridor.id}`}
              role="tab"
              ref={el => {
                if (el) tabRefs.current.set(corridor.id, el);
                else tabRefs.current.delete(corridor.id);
              }}
              aria-selected={isSelected}
              aria-controls="china-corridor-tabpanel"
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectCorridor(corridor.id)}
              onKeyDown={e => handleTabKeyDown(e, corridor.id)}
            >
              <strong>{corridor.name}</strong>
              <small>
                {available}/{corridor.conditions.length} families available · {AVAILABILITY_LABELS[corridor.availability]}
              </small>
            </button>
          );
        })}
      </div>

      <div className="china-corridor-filters" role="group" aria-label="Signal-family filters">
        {CHINA_CORRIDOR_SIGNAL_FAMILIES.map(family => (
          <button
            key={family}
            type="button"
            data-family-filter={family}
            aria-pressed={selectedFamilies.has(family)}
            onClick={() => {
              setSelectedFamilies(prev => {
                const next = new Set(prev);
                if (next.has(family)) next.delete(family);
                else next.add(family);
                return next;
              });
            }}
          >
            {FAMILY_LABELS[family]}
          </button>
        ))}
      </div>

      <section
        id="china-corridor-tabpanel"
        role="tabpanel"
        aria-labelledby={`china-corridor-tab-${selected.id}`}
      >
        <div className="china-corridor-detail__heading">
          <div>
            <h3>{selected.name}</h3>
            <p className="china-corridor-description">{selected.description}</p>
          </div>
          <span className={`china-corridor-status china-corridor-status--${selected.availability}`}>
            {AVAILABILITY_LABELS[selected.availability]}
          </span>
        </div>
        {showRendererHint && (
          <p className="china-corridor-renderer-hint" role="status">{RENDERER_HINT}</p>
        )}
        <div className="china-corridor-conditions">
          {filteredConditions.length === 0 ? (
            <p className="china-corridor-missing">Select at least one signal family.</p>
          ) : (
            filteredConditions.map((condition, i) => (
              <ConditionCard key={`${condition.family}-${i}`} condition={condition} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

const CHINA_CORRIDOR_STYLES = `
  .china-corridor-panel { display: grid; gap: 12px; min-width: 0; }
  .china-corridor-compare { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 8px; }
  .china-corridor-compare button { min-height: 64px; text-align: left; padding: 8px; color: var(--text); background: color-mix(in srgb,var(--panel-bg) 80%,transparent); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
  .china-corridor-compare button[aria-selected="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .china-corridor-compare strong,.china-corridor-compare small { display: block; }
  .china-corridor-compare small { margin-top: 4px; color: var(--text-dim); }
  .china-corridor-filters { display: flex; flex-wrap: wrap; gap: 6px; }
  .china-corridor-filters button { min-height: 36px; padding: 5px 9px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-dim); cursor: pointer; }
  .china-corridor-filters button[aria-pressed="true"] { color: var(--text); border-color: var(--accent); background: color-mix(in srgb,var(--accent) 14%,transparent); }
  .china-corridor-detail__heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .china-corridor-detail__heading h3 { margin: 0; font-size: 14px; }
  .china-corridor-description { margin: 4px 0 0; color: var(--text-dim); font-size: 11px; line-height: 1.45; }
  .china-corridor-conditions { display: grid; grid-template-columns: repeat(auto-fit,minmax(210px,1fr)); gap: 8px; margin-top: 10px; }
  .china-corridor-condition { min-width: 0; padding: 9px; border: 1px solid var(--border); border-radius: 6px; }
  .china-corridor-condition header { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .china-corridor-condition h4 { margin: 0; font-size: 12px; }
  .china-corridor-status { font: 700 9px/1 var(--font-mono); letter-spacing: .05em; text-transform: uppercase; }
  .china-corridor-status--available { color: #39c77a; }
  .china-corridor-status--partial,.china-corridor-status--stale { color: #e5a742; }
  .china-corridor-status--unavailable { color: var(--text-dim); }
  .china-corridor-provider { margin-top: 5px; color: var(--text-dim); font-size: 9px; overflow-wrap: anywhere; }
  .china-corridor-sources { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 7px; }
  .china-corridor-source { padding-top: 7px; border-top: 1px solid var(--border); }
  .china-corridor-source__summary { font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
  .china-corridor-source__meta { display: flex; flex-wrap: wrap; gap: 3px 8px; margin-top: 5px; color: var(--text-dim); font-size: 9px; overflow-wrap: anywhere; }
  .china-corridor-source__meta a { color: var(--accent); }
  .china-corridor-missing { margin: 8px 0 0; color: var(--text-dim); font-size: 11px; line-height: 1.4; }
  .china-corridor-renderer-hint { margin: 8px 0 0; color: var(--warning); font-size: 11px; line-height: 1.4; }
  @media (max-width: 520px) {
    .china-corridor-compare { grid-template-columns: 1fr 1fr; }
    .china-corridor-conditions { grid-template-columns: 1fr; }
    .china-corridor-detail__heading { display: block; }
  }
`;

function injectStyles(): void {
  if (document.getElementById('china-corridor-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'china-corridor-panel-styles';
  style.textContent = CHINA_CORRIDOR_STYLES;
  document.head.appendChild(style);
}

// Inject styles eagerly when module is loaded (no bridge constructor to trigger it)
if (typeof document !== 'undefined') injectStyles();

export function ChinaCorridorPanel() {
  return (
    <PanelShell
      id="china-corridors"
      title="China Logistics Corridors"
      infoTooltip="Transparent control towers for four reviewed China logistics corridors. Each condition retains its own source, time, availability, and freshness; no aggregate risk score is produced."
      defaultRowSpan={2}
      className="panel-wide"
    >
      <ChinaCorridorPanelContent />
    </PanelShell>
  );
}
