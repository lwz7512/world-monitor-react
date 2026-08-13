import { useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Constants & types ─────────────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', UK: '🇬🇧', EU: '🇪🇺', EUR: '🇪🇺',
  EA: '🇪🇺', DE: '🇩🇪', FR: '🇫🇷', JP: '🇯🇵', CN: '🇨🇳', CA: '🇨🇦', AU: '🇦🇺',
};

const EU_COUNTRIES = new Set(['EU', 'EA', 'EUR', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PT', 'FI', 'IE', 'GR']);

const IMPACT_COLORS: Record<string, string> = {
  high: '#e74c3c', medium: '#f39c12', low: 'rgba(255,255,255,0.3)',
};

type RegionFilter = 'all' | 'us' | 'eu';

interface EconomicEvent {
  event: string; country: string; date: string; impact: string;
  actual: string; estimate: string; previous: string; unit: string;
}

export interface EconomicCalendarData { events: EconomicEvent[]; }

// ── Pure helpers ──────────────────────────────────────────────────────────────

function formatDateGroup(dateStr: string): string {
  if (!dateStr || dateStr === 'Unknown') return 'Unknown';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtVal(val: string, unit: string): string {
  return unit ? `${val} ${unit}` : val;
}

function countdown(dateStr: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return Math.abs(days) < 14 ? `${Math.abs(days)}d ago` : `${Math.round(Math.abs(days) / 7)}w ago`;
  if (days < 14) return `in ${days}d`;
  return `in ${Math.round(days / 7)}w`;
}

function filterEvents(events: EconomicEvent[], region: RegionFilter): EconomicEvent[] {
  if (region === 'us') return events.filter(e => e.country === 'US');
  if (region === 'eu') return events.filter(e => EU_COUNTRIES.has(e.country));
  return events;
}

function groupByDate(events: EconomicEvent[]): { date: string; events: EconomicEvent[] }[] {
  const map = new Map<string, EconomicEvent[]>();
  for (const ev of events) {
    const key = ev.date || 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ev);
  }
  return [...map.entries()].map(([date, evs]) => ({ date, events: evs }));
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchEconomicCalendar(_signal: AbortSignal): Promise<EconomicCalendarData> {
  const { EconomicServiceClient } = await import('@/generated/client/worldmonitor/economic/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new EconomicServiceClient(getRpcBaseUrl(), {
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });

  const today    = new Date();
  const fromDate = today.toISOString().slice(0, 10);
  const toDate   = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const resp     = await client.getEconomicCalendar({ fromDate, toDate });

  if (resp.unavailable || !resp.events?.length) throw new Error('Economic calendar data unavailable.');
  return { events: resp.events as EconomicEvent[] };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: EconomicEvent }) {
  const impact      = (ev.impact || 'low').toLowerCase();
  const impactColor = IMPACT_COLORS[impact] ?? IMPACT_COLORS.low;
  const flag        = COUNTRY_FLAGS[ev.country] ?? ev.country;
  const isHigh      = impact === 'high';

  const hasActual = Boolean(ev.actual);
  const rightText  = hasActual ? fmtVal(ev.actual, ev.unit) : countdown(ev.date);
  const rightStyle: React.CSSProperties = hasActual
    ? { color: 'var(--text)', fontWeight: 600 }
    : { color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' };

  return (
    <tr style={{ fontSize: 12, lineHeight: 1.2 }}>
      <td style={{ padding: '4px 8px 4px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}>
        <span style={{ marginRight: 5 }}>{flag}</span>
        <span style={{ fontWeight: isHigh ? 600 : 400 }}>{ev.event}</span>
      </td>
      <td style={{ padding: '4px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: impactColor, verticalAlign: 'middle' }} />
      </td>
      <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...rightStyle }}>
        {rightText}
      </td>
    </tr>
  );
}

function DateGroupRows({ date, events, first }: { date: string; events: EconomicEvent[]; first: boolean }) {
  return (
    <>
      <tr>
        <td colSpan={3} style={{
          padding: '10px 0 3px', fontSize: 10, fontWeight: 600,
          color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em',
          borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.06)',
        }}>
          {formatDateGroup(date)}
        </td>
      </tr>
      {events.map((ev, i) => <EventRow key={`${ev.event}-${i}`} ev={ev} />)}
    </>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function EconomicCalendarPanelContent() {
  const { data, loading, error, refetch } = usePanelData<EconomicCalendarData>(fetchEconomicCalendar, {
    ttlMs: 60 * 60 * 1000,
  });
  const [region, setRegion] = useState<RegionFilter>('all');

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

  const filtered = filterEvents(data.events, region);
  const groups   = groupByDate(filtered);
  const emptyMsg = region === 'all' ? 'No upcoming economic events' : 'No events for selected region';

  return (
    <>
      {/* Region tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '0 14px 10px' }}>
        {(['all', 'us', 'eu'] as RegionFilter[]).map(r => (
          <button key={r} onClick={() => setRegion(r)} style={{
            padding: '3px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
            borderRadius: 3, border: 'none', cursor: 'pointer',
            background: region === r ? 'rgba(255,255,255,0.15)' : 'transparent',
            color: region === r ? 'var(--text)' : 'rgba(255,255,255,0.35)',
          }}>
            {r === 'all' ? 'All' : r.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{ padding: '0 14px 12px', maxHeight: 440, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 'auto' }} />
            <col style={{ width: 20 }} />
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ textAlign: 'left', padding: '0 8px 8px 0', fontWeight: 600 }}>Event</th>
              <th style={{ padding: '0 0 8px', fontWeight: 600 }} />
              <th style={{ textAlign: 'right', padding: '0 0 8px', fontWeight: 600 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: '20px 0', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                  {emptyMsg}
                </td>
              </tr>
            ) : (
              groups.map((g, i) => <DateGroupRows key={g.date} date={g.date} events={g.events} first={i === 0} />)
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function EconomicCalendarPanel() {
  return (
    <PanelShell
      id="economic-calendar"
      title="Economic Calendar"
      infoTooltip={t('components.economicCalendar.infoTooltip')}
    >
      <EconomicCalendarPanelContent />
    </PanelShell>
  );
}
