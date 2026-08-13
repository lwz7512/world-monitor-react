import { usePanelData } from '@/hooks/usePanelData';
import { t, getLocale } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EarningsEntry {
  symbol: string;
  company: string;
  date: string;
  hour: string;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  epsActual: number | null;
  revenueActual: number | null;
  hasActuals: boolean;
  surpriseDirection: string;
}

export interface EarningsCalendarData {
  groups: { date: string; entries: EarningsEntry[] }[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtEps(v: number | null): string {
  if (v == null) return '';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

function fmtRevenue(v: number | null): string {
  if (v == null || v <= 0) return '';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6)  return `$${Math.round(v / 1e6)}M`;
  return `$${v}`;
}

function surprisePct(actual: number | null, estimate: number | null): string {
  if (actual == null || estimate == null || estimate === 0) return '';
  const pct = ((actual - estimate) / Math.abs(estimate)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function dateLabel(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  const formatted = d.toLocaleDateString(getLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
  if (days === 0) return t('components.earningsCalendar.today', { date: formatted });
  if (days === 1) return t('components.earningsCalendar.tomorrow', { date: formatted });
  return formatted.toUpperCase().replace(',', ' ·');
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchEarnings(_signal: AbortSignal): Promise<EarningsCalendarData> {
  const { MarketServiceClient } = await import('@/generated/client/worldmonitor/market/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), {
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });

  const today  = new Date();
  const future = new Date();
  future.setDate(future.getDate() + 14);
  const fromDate = today.toISOString().slice(0, 10);
  const toDate   = future.toISOString().slice(0, 10);

  const resp = await client.listEarningsCalendar({ fromDate, toDate });
  if (resp.unavailable || !resp.earnings?.length) throw new Error(t('components.earningsCalendar.errors.noData'));

  const grouped = new Map<string, EarningsEntry[]>();
  for (const e of resp.earnings as EarningsEntry[]) {
    const key = e.date || 'Unknown';
    const arr = grouped.get(key);
    if (arr) arr.push(e); else grouped.set(key, [e]);
  }

  return {
    groups: [...grouped.keys()].sort().map(date => ({ date, entries: grouped.get(date)! })),
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HourBadge({ hour }: { hour: string }) {
  if (!hour) return null;
  const label = hour === 'bmo' ? 'BMO' : hour === 'amc' ? 'AMC' : hour.toUpperCase();
  const style: React.CSSProperties = hour === 'bmo'
    ? { background: 'rgba(46,204,113,0.15)', color: '#2ecc71' }
    : hour === 'amc'
      ? { background: 'rgba(52,152,219,0.15)', color: '#3498db' }
      : { background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)' };
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, letterSpacing: '0.04em', ...style }}>
      {label}
    </span>
  );
}

function SurpriseBadge({ direction, pct }: { direction: string; pct: string }) {
  const style: React.CSSProperties = direction === 'beat'
    ? { background: 'rgba(46,204,113,0.2)', color: '#2ecc71' }
    : direction === 'miss'
      ? { background: 'rgba(231,76,60,0.2)', color: '#e74c3c' }
      : { background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)' };
  const label = direction === 'beat'
    ? t('components.earningsCalendar.surprise.beat')
    : direction === 'miss'
      ? t('components.earningsCalendar.surprise.miss')
      : t('components.earningsCalendar.surprise.inLine');
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, ...style }}>
      {label}{pct ? ` ${pct}` : ''}
    </span>
  );
}

function EntryRow({ e }: { e: EarningsEntry }) {
  const epsActFmt = fmtEps(e.epsActual);
  const epsEstFmt = fmtEps(e.epsEstimate);
  const revActFmt = fmtRevenue(e.revenueActual);
  const revEstFmt = fmtRevenue(e.revenueEstimate);
  const pct       = surprisePct(e.epsActual, e.epsEstimate);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      {/* Hour badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flexShrink: 0, paddingTop: 1 }}>
        <HourBadge hour={e.hour} />
      </div>

      {/* Company + symbol */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {e.company}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.04em' }}>{e.symbol}</div>
      </div>

      {/* EPS + revenue */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
        {e.hasActuals && epsActFmt ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>
              {t('components.earningsCalendar.epsActual', { value: epsActFmt })}
            </span>
            <SurpriseBadge direction={e.surpriseDirection} pct={pct} />
          </div>
        ) : epsEstFmt ? (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {t('components.earningsCalendar.epsEstimate', { value: epsEstFmt })}
          </span>
        ) : null}

        {e.hasActuals && revActFmt ? (
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {t('components.earningsCalendar.revenueActual', { value: revActFmt })}
          </span>
        ) : revEstFmt ? (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>
            {t('components.earningsCalendar.revenueEstimate', { value: revEstFmt })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DateGroup({ date, entries, first }: { date: string; entries: EarningsEntry[]; first: boolean }) {
  return (
    <div style={{ borderTop: first ? 'none' : '1px solid rgba(255,255,255,0.06)', paddingTop: first ? 0 : 10, paddingBottom: 2 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0 5px' }}>
        {dateLabel(date)}
      </div>
      {entries.map(e => <EntryRow key={`${e.symbol}-${e.date}`} e={e} />)}
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function EarningsCalendarPanelContent() {
  const { data, loading, error, refetch } = usePanelData<EarningsCalendarData>(fetchEarnings, {
    ttlMs: 60 * 60 * 1000,
  });

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
    <div style={{ padding: '0 14px 12px', maxHeight: 480, overflowY: 'auto' }}>
      {data.groups.map((g, i) => (
        <DateGroup key={g.date} date={g.date} entries={g.entries} first={i === 0} />
      ))}
    </div>
  );
}

export function EarningsCalendarPanel() {
  return (
    <PanelShell
      id="earnings-calendar"
      title={t('components.earningsCalendar.title')}
      infoTooltip={t('components.earningsCalendar.infoTooltip')}
    >
      <EarningsCalendarPanelContent />
    </PanelShell>
  );
}
