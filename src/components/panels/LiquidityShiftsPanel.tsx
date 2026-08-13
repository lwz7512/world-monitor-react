import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { formatChange, getChangeClass } from '@/utils';
import { proFreshRpcFetch } from '@/services/premium-fetch';
import { PanelShell } from '@/components/PanelShell';

// ── Constants & types ─────────────────────────────────────────────────────────

const TOP_STOCKS    = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
const COT_PRIORITY  = ['CL', 'GC', 'SI', 'ES', 'NQ'];
const INSTRUMENT_LABELS: Record<string, string> = {
  ES: 'S&P 500 futures',
  NQ: 'Nasdaq futures',
};

interface CotRow {
  code: string;
  label: string;
  longPos: number;
  shortPos: number;
  net: number | null;
  levNet: number | null;
  hasLev: boolean;
}

interface StockRow {
  symbol: string;
  name: string;
  change: number;
}

export interface LiquidityShiftsData {
  cotRows:    CotRow[];
  stockRows:  StockRow[];
  reportDate: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: string | number | undefined): number {
  if (typeof v === 'number') return v;
  const n = parseInt(String(v ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

function pct(longPos: number, shortPos: number): number | null {
  const gross = longPos + shortPos;
  return gross > 0 ? ((longPos - shortPos) / gross) * 100 : null;
}

function fmtLevShift(v: number | null): string {
  if (v === null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchLiquidityShifts(_signal: AbortSignal): Promise<LiquidityShiftsData> {
  const { MarketServiceClient } = await import('@/generated/client/worldmonitor/market/v1/service_client');
  const { getRpcBaseUrl } = await import('@/services/rpc-client');
  const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: proFreshRpcFetch });

  const [cotResp, stocksResp] = await Promise.all([
    client.getCotPositioning({}),
    client.listMarketQuotes({ symbols: TOP_STOCKS }),
  ]);

  const cotRows: CotRow[] = (cotResp.instruments ?? [])
    .filter(i => COT_PRIORITY.includes(i.code ?? ''))
    .sort((a, b) => COT_PRIORITY.indexOf(a.code ?? '') - COT_PRIORITY.indexOf(b.code ?? ''))
    .map(row => {
      const longPos  = toNum(row.assetManagerLong  ?? 0);
      const shortPos = toNum(row.assetManagerShort ?? 0);
      const levLong  = toNum(row.leveragedFundsLong  ?? 0);
      const levShort = toNum(row.leveragedFundsShort ?? 0);
      const hasLev   = levLong > 0 || levShort > 0;
      const code     = row.code ?? '';
      return {
        code,
        label:   INSTRUMENT_LABELS[code] ?? row.name ?? code,
        longPos, shortPos,
        net:     pct(longPos, shortPos),
        levNet:  hasLev ? pct(levLong, levShort) : null,
        hasLev,
      };
    });

  const stockOrder = new Map(TOP_STOCKS.map((sym, i) => [sym, i]));
  const stockRows: StockRow[] = [...(stocksResp.quotes ?? [])]
    .sort((a, b) => {
      const ai = stockOrder.get(a.symbol ?? '') ?? Number.MAX_SAFE_INTEGER;
      const bi = stockOrder.get(b.symbol ?? '') ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    })
    .map(q => ({ symbol: q.symbol ?? '', name: q.name || q.symbol || '', change: Number(q.change ?? 0) }));

  if (cotRows.length === 0 && stockRows.length === 0) {
    throw new Error(t('components.liquidityShifts.unavailable'));
  }

  return { cotRows, stockRows, reportDate: cotResp.reportDate ?? '' };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ShiftPill({ value }: { value: number | null }) {
  if (value === null) return <span className="commodity-change">—</span>;
  return <span className={`commodity-change ${getChangeClass(value)}`}>{formatChange(value)}</span>;
}

function CotRowItem({ row }: { row: CotRow }) {
  return (
    <div className="liquidity-row">
      <div className="liquidity-row__info">
        <div className="market-name">{row.label}</div>
        <div className="market-symbol">
          {row.code} • {t('components.liquidityShifts.longShort', { long: String(row.longPos), short: String(row.shortPos) })}
        </div>
      </div>
      <div className="liquidity-row__values">
        <div><ShiftPill value={row.net} /></div>
        {row.hasLev && (
          <div className="market-symbol">{t('components.liquidityShifts.lev')} {fmtLevShift(row.levNet)}</div>
        )}
      </div>
    </div>
  );
}

function StockRowItem({ row }: { row: StockRow }) {
  return (
    <div className="market-item liquidity-stock-row">
      <div className="market-info">
        <span className="market-name">{row.name}</span>
        <span className="market-symbol">{row.symbol}</span>
      </div>
      <div><ShiftPill value={row.change} /></div>
    </div>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function LiquidityShiftsPanelContent() {
  const { data, loading, error, refetch } = usePanelData<LiquidityShiftsData>(fetchLiquidityShifts, {
    ttlMs: 5 * 60 * 1000,
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
    <div className="liquidity-shifts-panel">
      <div className="liquidity-shifts-panel__section-title">{t('components.liquidityShifts.cotSection')}</div>
      {data.cotRows.length > 0
        ? data.cotRows.map(row => <CotRowItem key={row.code} row={row} />)
        : <div className="market-symbol">{t('components.liquidityShifts.noCot')}</div>
      }
      <div className="liquidity-shifts-panel__section-title liquidity-shifts-panel__section-title--gap">
        {t('components.liquidityShifts.stocksSection')}
      </div>
      {data.stockRows.length > 0
        ? data.stockRows.map(row => <StockRowItem key={row.symbol} row={row} />)
        : <div className="market-symbol">{t('components.liquidityShifts.noStocks')}</div>
      }
      {data.reportDate && (
        <div className="market-symbol liquidity-report-date">
          {t('components.liquidityShifts.reportDate', { date: data.reportDate })}
        </div>
      )}
    </div>
  );
}

export function LiquidityShiftsPanel() {
  return (
    <PanelShell
      id="liquidity-shifts"
      title={t('components.liquidityShifts.title')}
      infoTooltip={t('components.liquidityShifts.infoTooltip')}
    >
      <LiquidityShiftsPanelContent />
    </PanelShell>
  );
}
