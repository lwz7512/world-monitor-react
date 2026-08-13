import { useEffect, useMemo, useRef, useState } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { getNationalDebtData } from '@/services/economic';
import type { NationalDebtEntry } from '@/services/economic';
import { PanelShell } from '@/components/PanelShell';

// ── Lookups ───────────────────────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  AFG: '🇦🇫', ALB: '🇦🇱', DZA: '🇩🇿', AGO: '🇦🇴', ARG: '🇦🇷', ARM: '🇦🇲', AUS: '🇦🇺', AUT: '🇦🇹',
  AZE: '🇦🇿', BHS: '🇧🇸', BHR: '🇧🇭', BGD: '🇧🇩', BLR: '🇧🇾', BEL: '🇧🇪', BLZ: '🇧🇿', BEN: '🇧🇯',
  BTN: '🇧🇹', BOL: '🇧🇴', BIH: '🇧🇦', BWA: '🇧🇼', BRA: '🇧🇷', BRN: '🇧🇳', BGR: '🇧🇬', BFA: '🇧🇫',
  BDI: '🇧🇮', CPV: '🇨🇻', KHM: '🇰🇭', CMR: '🇨🇲', CAN: '🇨🇦', CAF: '🇨🇫', TCD: '🇹🇩', CHL: '🇨🇱',
  CHN: '🇨🇳', COL: '🇨🇴', COM: '🇰🇲', COD: '🇨🇩', COG: '🇨🇬', CRI: '🇨🇷', CIV: '🇨🇮', HRV: '🇭🇷',
  CYP: '🇨🇾', CZE: '🇨🇿', DNK: '🇩🇰', DJI: '🇩🇯', DOM: '🇩🇴', ECU: '🇪🇨', EGY: '🇪🇬', SLV: '🇸🇻',
  GNQ: '🇬🇶', ERI: '🇪🇷', EST: '🇪🇪', SWZ: '🇸🇿', ETH: '🇪🇹', FJI: '🇫🇯', FIN: '🇫🇮', FRA: '🇫🇷',
  GAB: '🇬🇦', GMB: '🇬🇲', GEO: '🇬🇪', DEU: '🇩🇪', GHA: '🇬🇭', GRC: '🇬🇷', GTM: '🇬🇹', GIN: '🇬🇳',
  GNB: '🇬🇼', GUY: '🇬🇾', HTI: '🇭🇹', HND: '🇭🇳', HKG: '🇭🇰', HUN: '🇭🇺', ISL: '🇮🇸', IND: '🇮🇳',
  IDN: '🇮🇩', IRN: '🇮🇷', IRQ: '🇮🇶', IRL: '🇮🇪', ISR: '🇮🇱', ITA: '🇮🇹', JAM: '🇯🇲', JPN: '🇯🇵',
  JOR: '🇯🇴', KAZ: '🇰🇿', KEN: '🇰🇪', KOR: '🇰🇷', KWT: '🇰🇼', KGZ: '🇰🇬', LAO: '🇱🇦',
  LVA: '🇱🇻', LBN: '🇱🇧', LSO: '🇱🇸', LBR: '🇱🇷', LBY: '🇱🇾', LTU: '🇱🇹', LUX: '🇱🇺', MAC: '🇲🇴',
  MDG: '🇲🇬', MWI: '🇲🇼', MYS: '🇲🇾', MDV: '🇲🇻', MLI: '🇲🇱', MLT: '🇲🇹', MRT: '🇲🇷', MUS: '🇲🇺',
  MEX: '🇲🇽', MDA: '🇲🇩', MNG: '🇲🇳', MNE: '🇲🇪', MAR: '🇲🇦', MOZ: '🇲🇿', MMR: '🇲🇲', NAM: '🇳🇦',
  NPL: '🇳🇵', NLD: '🇳🇱', NZL: '🇳🇿', NIC: '🇳🇮', NER: '🇳🇪', NGA: '🇳🇬', MKD: '🇲🇰', NOR: '🇳🇴',
  OMN: '🇴🇲', PAK: '🇵🇰', PAN: '🇵🇦', PNG: '🇵🇬', PRY: '🇵🇾', PER: '🇵🇪', PHL: '🇵🇭', POL: '🇵🇱',
  PRT: '🇵🇹', QAT: '🇶🇦', ROU: '🇷🇴', RUS: '🇷🇺', RWA: '🇷🇼', SAU: '🇸🇦', SEN: '🇸🇳', SRB: '🇷🇸',
  SLE: '🇸🇱', SGP: '🇸🇬', SVK: '🇸🇰', SVN: '🇸🇮', SOM: '🇸🇴', ZAF: '🇿🇦', SSD: '🇸🇸', ESP: '🇪🇸',
  LKA: '🇱🇰', SDN: '🇸🇩', SUR: '🇸🇷', SWE: '🇸🇪', CHE: '🇨🇭', TWN: '🇹🇼', TJK: '🇹🇯',
  TZA: '🇹🇿', THA: '🇹🇭', TLS: '🇹🇱', TGO: '🇹🇬', TTO: '🇹🇹', TUN: '🇹🇳', TUR: '🇹🇷', TKM: '🇹🇲',
  UGA: '🇺🇬', UKR: '🇺🇦', ARE: '🇦🇪', GBR: '🇬🇧', USA: '🇺🇸', URY: '🇺🇾', UZB: '🇺🇿', VEN: '🇻🇪',
  VNM: '🇻🇳', YEM: '🇾🇪', ZMB: '🇿🇲', ZWE: '🇿🇼',
};

const NAMES: Record<string, string> = {
  AFG: 'Afghanistan', ALB: 'Albania', DZA: 'Algeria', AGO: 'Angola', ARG: 'Argentina',
  ARM: 'Armenia', AUS: 'Australia', AUT: 'Austria', AZE: 'Azerbaijan', BHS: 'Bahamas',
  BHR: 'Bahrain', BGD: 'Bangladesh', BLR: 'Belarus', BEL: 'Belgium', BLZ: 'Belize',
  BEN: 'Benin', BTN: 'Bhutan', BOL: 'Bolivia', BIH: 'Bosnia & Herzegovina', BWA: 'Botswana',
  BRA: 'Brazil', BRN: 'Brunei', BGR: 'Bulgaria', BFA: 'Burkina Faso', BDI: 'Burundi',
  CPV: 'Cabo Verde', KHM: 'Cambodia', CMR: 'Cameroon', CAN: 'Canada', CAF: 'Central African Rep.',
  TCD: 'Chad', CHL: 'Chile', CHN: 'China', COL: 'Colombia', COM: 'Comoros',
  COD: 'Dem. Rep. Congo', COG: 'Congo', CRI: 'Costa Rica', CIV: "Cote d'Ivoire", HRV: 'Croatia',
  CYP: 'Cyprus', CZE: 'Czech Republic', DNK: 'Denmark', DJI: 'Djibouti', DOM: 'Dominican Rep.',
  ECU: 'Ecuador', EGY: 'Egypt', SLV: 'El Salvador', GNQ: 'Equatorial Guinea', ERI: 'Eritrea',
  EST: 'Estonia', SWZ: 'Eswatini', ETH: 'Ethiopia', FJI: 'Fiji', FIN: 'Finland',
  FRA: 'France', GAB: 'Gabon', GMB: 'Gambia', GEO: 'Georgia', DEU: 'Germany',
  GHA: 'Ghana', GRC: 'Greece', GTM: 'Guatemala', GIN: 'Guinea', GNB: 'Guinea-Bissau',
  GUY: 'Guyana', HTI: 'Haiti', HND: 'Honduras', HKG: 'Hong Kong SAR', HUN: 'Hungary',
  ISL: 'Iceland', IND: 'India', IDN: 'Indonesia', IRN: 'Iran', IRQ: 'Iraq',
  IRL: 'Ireland', ISR: 'Israel', ITA: 'Italy', JAM: 'Jamaica', JPN: 'Japan',
  JOR: 'Jordan', KAZ: 'Kazakhstan', KEN: 'Kenya', KOR: 'Korea (South)',
  KWT: 'Kuwait', KGZ: 'Kyrgyzstan', LAO: 'Laos', LVA: 'Latvia', LBN: 'Lebanon',
  LSO: 'Lesotho', LBR: 'Liberia', LBY: 'Libya', LTU: 'Lithuania', LUX: 'Luxembourg',
  MAC: 'Macao SAR', MDG: 'Madagascar', MWI: 'Malawi', MYS: 'Malaysia', MDV: 'Maldives',
  MLI: 'Mali', MLT: 'Malta', MRT: 'Mauritania', MUS: 'Mauritius', MEX: 'Mexico',
  MDA: 'Moldova', MNG: 'Mongolia', MNE: 'Montenegro', MAR: 'Morocco', MOZ: 'Mozambique',
  MMR: 'Myanmar', NAM: 'Namibia', NPL: 'Nepal', NLD: 'Netherlands', NZL: 'New Zealand',
  NIC: 'Nicaragua', NER: 'Niger', NGA: 'Nigeria', MKD: 'North Macedonia', NOR: 'Norway',
  OMN: 'Oman', PAK: 'Pakistan', PAN: 'Panama', PNG: 'Papua New Guinea', PRY: 'Paraguay',
  PER: 'Peru', PHL: 'Philippines', POL: 'Poland', PRT: 'Portugal', QAT: 'Qatar',
  ROU: 'Romania', RUS: 'Russia', RWA: 'Rwanda', SAU: 'Saudi Arabia', SEN: 'Senegal',
  SRB: 'Serbia', SLE: 'Sierra Leone', SGP: 'Singapore', SVK: 'Slovakia', SVN: 'Slovenia',
  SOM: 'Somalia', ZAF: 'South Africa', SSD: 'South Sudan', ESP: 'Spain', LKA: 'Sri Lanka',
  SDN: 'Sudan', SUR: 'Suriname', SWE: 'Sweden', CHE: 'Switzerland',
  TWN: 'Taiwan', TJK: 'Tajikistan', TZA: 'Tanzania', THA: 'Thailand', TLS: 'Timor-Leste',
  TGO: 'Togo', TTO: 'Trinidad & Tobago', TUN: 'Tunisia', TUR: 'Turkey', TKM: 'Turkmenistan',
  UGA: 'Uganda', UKR: 'Ukraine', ARE: 'United Arab Emirates', GBR: 'United Kingdom',
  USA: 'United States', URY: 'Uruguay', UZB: 'Uzbekistan', VEN: 'Venezuela',
  VNM: 'Vietnam', YEM: 'Yemen', ZMB: 'Zambia', ZWE: 'Zimbabwe',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type SortMode = 'total' | 'gdp-ratio' | 'growth';
const PAGE_SIZE = 20;

function currentDebt(e: NationalDebtEntry): number {
  if (!e.perSecondRate || !e.baselineTs) return e.debtUsd ?? 0;
  const elapsed = (Date.now() - Number(e.baselineTs)) / 1000;
  return (e.debtUsd ?? 0) + e.perSecondRate * elapsed;
}

function fmtDebt(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(1)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  return `$${Math.round(usd).toLocaleString()}`;
}

function sortEntries(entries: NationalDebtEntry[], mode: SortMode): NationalDebtEntry[] {
  const copy = [...entries];
  if (mode === 'total') return copy.sort((a, b) => currentDebt(b) - currentDebt(a));
  if (mode === 'gdp-ratio') return copy.sort((a, b) => (b.debtToGdp ?? 0) - (a.debtToGdp ?? 0));
  return copy.sort((a, b) => (b.annualGrowth ?? 0) - (a.annualGrowth ?? 0));
}

async function fetcher(_signal: AbortSignal) {
  return getNationalDebtData();
}

// ── Row component ─────────────────────────────────────────────────────────────

function DebtRow({
  entry,
  rank,
  tickerRef,
}: {
  entry: NationalDebtEntry;
  rank: number;
  tickerRef: (iso3: string, el: HTMLSpanElement | null) => void;
}) {
  const ratio = Number.isFinite(entry.debtToGdp) && entry.debtToGdp > 0
    ? `${entry.debtToGdp.toFixed(1)}% of GDP`
    : '—';
  const growth = Number.isFinite(entry.annualGrowth) && entry.annualGrowth !== 0
    ? `${entry.annualGrowth > 0 ? '+' : ''}${entry.annualGrowth.toFixed(1)}% YoY`
    : '—';
  const growthCls = entry.annualGrowth > 5
    ? 'debt-growth-high'
    : entry.annualGrowth > 0 ? 'debt-growth-mid' : '';

  return (
    <div className="debt-row" data-iso3={entry.iso3}>
      <div className="debt-rank">{rank}</div>
      <div className="debt-flag">{FLAGS[entry.iso3] ?? '🌐'}</div>
      <div className="debt-info">
        <div className="debt-name">{NAMES[entry.iso3] ?? entry.iso3}</div>
        <div className="debt-meta">
          <span className="debt-ratio">{ratio}</span>
          <span className={`debt-growth ${growthCls}`}>{growth}</span>
        </div>
      </div>
      <span
        className="debt-ticker"
        data-iso3={entry.iso3}
        ref={el => tickerRef(entry.iso3, el)}
      >
        {fmtDebt(currentDebt(entry))}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NationalDebtPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, {
    ttlMs: 6 * 60 * 60 * 1000,
  });

  const [sort, setSort] = useState<SortMode>('total');
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const tickerRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const globalRef = useRef<HTMLSpanElement | null>(null);

  const entries = data?.entries ?? [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const base = q
      ? entries.filter(e =>
          e.iso3.toLowerCase().includes(q) ||
          (NAMES[e.iso3] ?? '').toLowerCase().includes(q),
        )
      : entries;
    return sortEntries(base, sort);
  }, [entries, sort, search]);

  const globalDebt = useMemo(
    () => entries.reduce((sum, e) => sum + currentDebt(e), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries],
  );

  // Ticker: mutate DOM directly to avoid re-rendering the whole list every second
  useEffect(() => {
    if (!filtered.length) return;
    const id = setInterval(() => {
      const gEl = globalRef.current;
      if (gEl) gEl.textContent = fmtDebt(entries.reduce((s, e) => s + currentDebt(e), 0));
      for (const entry of filtered.slice(0, visible)) {
        const el = tickerRefs.current.get(entry.iso3);
        if (el) el.textContent = fmtDebt(currentDebt(entry));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [filtered, visible, entries]);

  // Reset visible count when filter changes
  useEffect(() => { setVisible(PAGE_SIZE); }, [sort, search]);

  const registerTicker = (iso3: string, el: HTMLSpanElement | null) => {
    if (el) tickerRefs.current.set(iso3, el);
    else tickerRefs.current.delete(iso3);
  };

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">Loading debt data from IMF…</div>
      </div>
    );
  }

  if (error || !entries.length) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? 'Failed to load national debt data'}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>Retry</button>
      </div>
    );
  }

  const deficitCount = entries.filter(e => e.perSecondRate > 0).length;
  const surplusCount = entries.filter(e => e.perSecondRate === 0).length;
  const source = entries.reduce((best, e) => {
    const s = e.source?.trim() ?? '';
    return s.length > best.length ? s : best;
  }, '');

  return (
    <div className="debt-panel-container">
      <div className="debt-summary">
        <div className="debt-summary-card debt-summary-card-deficit debt-summary-card-world">
          <span className="debt-summary-label">World Debt</span>
          <span className="debt-summary-value" ref={globalRef}>{fmtDebt(globalDebt)}</span>
        </div>
        <div className="debt-summary-card debt-summary-card-warning">
          <span className="debt-summary-label">In Deficit</span>
          <span className="debt-summary-value">{deficitCount}</span>
        </div>
        <div className="debt-summary-card debt-summary-card-surplus">
          <span className="debt-summary-label">Running Surplus</span>
          <span className="debt-summary-value">{surplusCount}</span>
        </div>
      </div>

      <div className="debt-controls">
        <div className="debt-sort-tabs">
          {(['total', 'gdp-ratio', 'growth'] as SortMode[]).map(m => (
            <button
              key={m}
              className={`debt-tab${sort === m ? ' active' : ''}`}
              onClick={() => setSort(m)}
            >
              {m === 'total' ? 'Total Debt' : m === 'gdp-ratio' ? 'Debt/GDP' : '1Y Growth'}
            </button>
          ))}
        </div>
        <input
          className="debt-search"
          type="text"
          placeholder="Search country…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="debt-list">
        {filtered.slice(0, visible).map((entry, idx) => (
          <DebtRow
            key={entry.iso3}
            entry={entry}
            rank={idx + 1}
            tickerRef={registerTicker}
          />
        ))}
      </div>

      {visible < filtered.length && (
        <button className="debt-load-more" onClick={() => setVisible(v => v + PAGE_SIZE)}>
          Load {Math.min(PAGE_SIZE, filtered.length - visible)} more
          <span className="debt-load-more-count">({filtered.length - visible} remaining)</span>
        </button>
      )}

      <div className="debt-footer">
        <span className="debt-source">Source: {source || 'IMF WEO'}</span>
      </div>
    </div>
  );
}

export function NationalDebtPanel() {
  return (
    <PanelShell
      id="national-debt"
      title="National Debt Clock"
      infoTooltip="Live national debt estimates for 150+ countries. Data anchored at 2024-01-01 and accruing using IMF deficit projections."
    >
      <NationalDebtPanelContent />
    </PanelShell>
  );
}
