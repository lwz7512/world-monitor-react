import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { toApiUrl } from '@/services/runtime';
import { PanelShell } from '@/components/PanelShell';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrossCurrencyPrice { currency: string; flag: string; price: number }
interface CotCategory { longPositions: string; shortPositions: string; netPct: number; oiSharePct: number; wowNetDelta: string }
interface CotData { reportDate: string; nextReleaseDate: string; openInterest: string; managedMoney?: CotCategory; producerSwap?: CotCategory }
interface SessionRange { dayHigh: number; dayLow: number; prevClose: number }
interface Returns { w1: number; m1: number; ytd: number; y1: number }
interface Range52w { hi: number; lo: number; positionPct: number }
interface Driver { symbol: string; label: string; value: number; changePct: number; correlation30d: number }
interface CbHolder { iso3: string; name: string; tonnes: number; pctOfReserves: number }
interface CbMover { iso3: string; name: string; deltaTonnes12m: number }
interface CbReserves { asOfMonth: string; totalTonnes: number; topHolders: CbHolder[]; topBuyers12m: CbMover[]; topSellers12m: CbMover[] }
interface EtfFlows { asOfDate: string; tonnes: number; aumUsd: number; nav: number; changeW1Tonnes: number; changeM1Tonnes: number; changeY1Tonnes: number; changeW1Pct: number; changeM1Pct: number; changeY1Pct: number; sparkline90d: number[] }

export interface GoldIntelligenceData {
  goldPrice: number; goldChangePct: number; goldSparkline: number[];
  silverPrice: number; platinumPrice: number; palladiumPrice: number;
  goldSilverRatio?: number; goldPlatinumPremiumPct?: number;
  crossCurrencyPrices: CrossCurrencyPrice[];
  cot?: CotData; session?: SessionRange; returns?: Returns; range52w?: Range52w;
  drivers: Driver[]; etfFlows?: EtfFlows; cbReserves?: CbReserves;
  updatedAt: string; unavailable?: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtPrice(v: number, decimals = 2): string {
  if (!Number.isFinite(v) || v <= 0) return '--';
  return v >= 10000 ? Math.round(v).toLocaleString() : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtInt(raw: string | number): string {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  return Number.isFinite(n) ? Math.round(n).toLocaleString() : '--';
}
function fmtPct(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}
function fmtSignedInt(raw: string | number): string {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  if (!Number.isFinite(n)) return '--';
  return `${n >= 0 ? '+' : ''}${Math.round(n).toLocaleString()}`;
}
function freshnessLabel(iso: string): { text: string; dot: string } {
  if (!iso) return { text: 'Updated —', dot: 'var(--text-dim)' };
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return { text: 'Updated now', dot: '#2ecc71' };
  const mins = Math.floor(diffMs / 60000);
  const dot = mins < 10 ? '#2ecc71' : mins < 30 ? '#f5a623' : '#e74c3c';
  if (mins < 1) return { text: 'Updated just now', dot };
  if (mins < 60) return { text: `Updated ${mins}m ago`, dot };
  return { text: `Updated ${Math.floor(mins / 60)}h ago`, dot };
}
function ratioLabel(ratio: number): { text: string; color: string } {
  if (ratio > 80) return { text: 'Silver undervalued', color: '#f5a623' };
  if (ratio < 60) return { text: 'Gold undervalued', color: '#f5a623' };
  return { text: 'Neutral', color: 'var(--text-dim)' };
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchGoldIntelligence(signal: AbortSignal): Promise<GoldIntelligenceData> {
  const resp = await fetch(toApiUrl('/api/market/v1/get-gold-intelligence'), { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data: GoldIntelligenceData = await resp.json();
  if (data.unavailable) throw new Error('Gold data unavailable');
  return data;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Section({ title, children, mt = 10 }: { title: string; children: React.ReactNode; mt?: number }) {
  return (
    <div className="energy-tape-section" style={mt > 0 ? { marginTop: mt } : undefined}>
      <div className="energy-section-title">{title}</div>
      {children}
    </div>
  );
}

function MiniSparkline({ data, change, w = 80, h = 20 }: { data: number[]; change: number | null; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const lo = Math.min(...data), hi = Math.max(...data), rng = hi - lo || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / rng) * (h - 2) - 1).toFixed(1)}`).join(' ');
  const color = change != null && change >= 0 ? 'var(--green)' : 'var(--red)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mini-sparkline">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PositionBar({ netPct, label, wow }: { netPct: number; label: string; wow: string }) {
  const clamped = Math.max(-100, Math.min(100, netPct));
  const half    = Math.abs(clamped) / 100 * 50;
  const color   = clamped >= 0 ? '#2ecc71' : '#e74c3c';
  const left    = clamped >= 0 ? 50 : 50 - half;
  const wowN    = parseInt(wow, 10);
  return (
    <div style={{ margin: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginBottom: 2 }}>
        <span>
          {label}
          {Number.isFinite(wowN) && wowN !== 0 && (
            <span style={{ fontSize: 9, color: wowN >= 0 ? '#2ecc71' : '#e74c3c', fontWeight: 500 }}> Δ {fmtSignedInt(wow)}</span>
          )}
        </span>
        <span style={{ color, fontWeight: 600 }}>{clamped >= 0 ? '+' : ''}{clamped.toFixed(1)}%</span>
      </div>
      <div style={{ position: 'relative', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(255,255,255,0.15)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${left.toFixed(2)}%`, width: `${half.toFixed(2)}%`, background: color, borderRadius: 1 }} />
      </div>
    </div>
  );
}

// ── Section components ────────────────────────────────────────────────────────

function HeaderSection({ d }: { d: GoldIntelligenceData }) {
  const changeColor = d.goldChangePct >= 0 ? '#2ecc71' : '#e74c3c';
  const fresh = freshnessLabel(d.updatedAt);
  return (
    <Section title="Price & Performance" mt={0}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>${fmtPrice(d.goldPrice)}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: changeColor, padding: '1px 6px', borderRadius: 3, background: `${changeColor}22` }}>
          {fmtPct(d.goldChangePct)}
        </span>
        <MiniSparkline data={d.goldSparkline} change={d.goldChangePct} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--text-dim)' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: fresh.dot, display: 'inline-block' }} />
        <span>{fresh.text} • GC=F front-month</span>
      </div>
      {d.session && d.session.dayHigh > 0 && (
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
          Session H ${fmtPrice(d.session.dayHigh)} • L ${fmtPrice(d.session.dayLow)} • Prev ${fmtPrice(d.session.prevClose)}
        </div>
      )}
    </Section>
  );
}

function ReturnsSection({ d }: { d: GoldIntelligenceData }) {
  if (!d.returns && !d.range52w) return null;
  const clamped = d.range52w ? Math.max(0, Math.min(100, d.range52w.positionPct)) : 0;
  return (
    <Section title="Returns">
      {d.returns && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          {([['1W', d.returns.w1], ['1M', d.returns.m1], ['YTD', d.returns.ytd], ['1Y', d.returns.y1]] as [string, number][]).map(([lbl, pct]) => (
            <div key={lbl} style={{ flex: 1, textAlign: 'center', padding: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{lbl}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: pct >= 0 ? '#2ecc71' : '#e74c3c' }}>{fmtPct(pct, 1)}</div>
            </div>
          ))}
        </div>
      )}
      {d.range52w && d.range52w.hi > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>52-week range</div>
          <div style={{ position: 'relative', height: 8, background: 'linear-gradient(90deg,rgba(231,76,60,0.25),rgba(245,166,35,0.25),rgba(46,204,113,0.25))', borderRadius: 4, margin: '6px 0' }}>
            <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${clamped.toFixed(1)}%`, width: 3, background: '#fff', borderRadius: 1, boxShadow: '0 0 4px rgba(255,255,255,0.8)', transform: 'translateX(-50%)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)' }}>
            <span>Low ${fmtPrice(d.range52w.lo)}</span>
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>${fmtPrice(d.goldPrice)} • {clamped.toFixed(0)}% of range</span>
            <span>High ${fmtPrice(d.range52w.hi)}</span>
          </div>
        </div>
      )}
    </Section>
  );
}

function MetalsSection({ d }: { d: GoldIntelligenceData }) {
  const metals = [{ label: 'Silver', price: d.silverPrice }, { label: 'Platinum', price: d.platinumPrice }, { label: 'Palladium', price: d.palladiumPrice }];
  const rl = d.goldSilverRatio != null && Number.isFinite(d.goldSilverRatio) ? ratioLabel(d.goldSilverRatio) : null;
  return (
    <Section title="Metals Complex">
      {rl && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Gold/Silver Ratio</span>
          <span style={{ fontSize: 11, fontWeight: 600 }}>
            {d.goldSilverRatio!.toFixed(1)} <span style={{ fontSize: 9, color: rl.color, fontWeight: 400 }}>{rl.text}</span>
          </span>
        </div>
      )}
      {d.goldPlatinumPremiumPct != null && Number.isFinite(d.goldPlatinumPremiumPct) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Gold vs Platinum</span>
          <span style={{ fontSize: 11, fontWeight: 600 }}>{fmtPct(d.goldPlatinumPremiumPct, 1)} premium</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        {metals.map(m => (
          <div key={m.label} style={{ flex: 1, textAlign: 'center', padding: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{m.label}</div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>${fmtPrice(m.price)}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function FxSection({ d }: { d: GoldIntelligenceData }) {
  if (!d.crossCurrencyPrices.length) return null;
  return (
    <Section title="Gold in Major Currencies">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
        {d.crossCurrencyPrices.map(c => (
          <div key={c.currency} style={{ textAlign: 'center', padding: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{c.flag} XAU/{c.currency}</div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{fmtPrice(c.price, 0)}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function PositioningSection({ cot }: { cot: CotData }) {
  const mm = cot.managedMoney, ps = cot.producerSwap;
  return (
    <Section title="CFTC Positioning">
      {mm && <PositionBar netPct={mm.netPct} label="Managed Money (speculators)" wow={mm.wowNetDelta} />}
      {mm && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', padding: '2px 0' }}>
          <span>MM breakdown</span>
          <span>L {fmtInt(mm.longPositions)} / S {fmtInt(mm.shortPositions)} • {mm.oiSharePct.toFixed(1)}% OI</span>
        </div>
      )}
      {ps && <PositionBar netPct={ps.netPct} label="Producer/Swap (commercials)" wow={ps.wowNetDelta} />}
      {ps && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', padding: '2px 0' }}>
          <span>P/S breakdown</span>
          <span>L {fmtInt(ps.longPositions)} / S {fmtInt(ps.shortPositions)} • {ps.oiSharePct.toFixed(1)}% OI</span>
        </div>
      )}
      {cot.reportDate && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginTop: 6 }}>
          <span>As of {cot.reportDate}{cot.nextReleaseDate ? ` • next release ${cot.nextReleaseDate}` : ''}</span>
          <span>OI {fmtInt(cot.openInterest)}</span>
        </div>
      )}
    </Section>
  );
}

function EtfSection({ f }: { f: EtfFlows }) {
  if (!Number.isFinite(f.tonnes) || f.tonnes <= 0) return null;
  const aumStr = f.aumUsd >= 1e9 ? `$${(f.aumUsd / 1e9).toFixed(1)}B` : f.aumUsd > 0 ? `$${(f.aumUsd / 1e6).toFixed(0)}M` : '--';
  const flows = [['1W', f.changeW1Tonnes, f.changeW1Pct], ['1M', f.changeM1Tonnes, f.changeM1Pct], ['1Y', f.changeY1Tonnes, f.changeY1Pct]] as [string, number, number][];
  return (
    <Section title="Physical Flows (GLD)">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{f.tonnes.toFixed(1)} <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 500 }}>tonnes</span></span>
          <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>AUM {aumStr}{f.nav > 0 ? ` • NAV $${f.nav.toFixed(2)}` : ''}</span>
        </div>
        {f.sparkline90d.length > 1 && <MiniSparkline data={f.sparkline90d} change={f.changeM1Pct} />}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {flows.map(([lbl, dT, dP]) => (
          <div key={lbl} style={{ flex: 1, textAlign: 'center', padding: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>{lbl}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: dT >= 0 ? '#2ecc71' : '#e74c3c' }}>{dT >= 0 ? '+' : ''}{dT.toFixed(1)}t</div>
            <div style={{ fontSize: 9, color: dT >= 0 ? '#2ecc71' : '#e74c3c' }}>{dP >= 0 ? '+' : ''}{dP.toFixed(2)}%</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4, textAlign: 'right' }}>SPDR GLD • as of {f.asOfDate}</div>
    </Section>
  );
}

function CbReservesSection({ cb }: { cb: CbReserves }) {
  if (!cb.topHolders.length) return null;
  return (
    <Section title="Central-Bank Reserves">
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 4 }}>Top holders (tonnes)</div>
      {cb.topHolders.slice(0, 10).map((h, i) => (
        <div key={h.iso3} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '1px 0' }}>
          <span style={{ color: 'var(--text-dim)' }}>{i + 1}. {h.name}</span>
          <span style={{ fontWeight: 600 }}>{h.tonnes > 0 ? `${h.tonnes.toFixed(1)}t` : '—'}</span>
        </div>
      ))}
      {(cb.topBuyers12m.length > 0 || cb.topSellers12m.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 2 }}>Buyers 12M</div>
            {cb.topBuyers12m.slice(0, 5).map(m => (
              <div key={m.iso3} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '1px 0' }}>
                <span style={{ color: 'var(--text-dim)' }}>{m.name}</span>
                <span style={{ color: '#2ecc71', fontWeight: 600 }}>+{m.deltaTonnes12m.toFixed(1)}t</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 2 }}>Sellers 12M</div>
            {cb.topSellers12m.slice(0, 5).map(m => (
              <div key={m.iso3} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, padding: '1px 0' }}>
                <span style={{ color: 'var(--text-dim)' }}>{m.name}</span>
                <span style={{ color: '#e74c3c', fontWeight: 600 }}>{m.deltaTonnes12m.toFixed(1)}t</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 6, textAlign: 'right' }}>IMF IFS • as of {cb.asOfMonth}</div>
    </Section>
  );
}

function DriversSection({ drivers }: { drivers: Driver[] }) {
  if (!drivers.length) return null;
  return (
    <Section title="Drivers">
      {drivers.map(dr => {
        const chColor   = dr.changePct >= 0 ? '#2ecc71' : '#e74c3c';
        const corrColor = dr.correlation30d <= -0.3 ? '#2ecc71' : dr.correlation30d >= 0.3 ? '#e74c3c' : 'var(--text-dim)';
        return (
          <div key={dr.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 10 }}>
            <span style={{ color: 'var(--text-dim)' }}>{dr.label}</span>
            <span>
              <span style={{ fontWeight: 600 }}>{dr.value.toFixed(2)}</span>
              <span style={{ color: chColor, marginLeft: 4 }}>{fmtPct(dr.changePct, 2)}</span>
              <span style={{ color: corrColor, marginLeft: 8, fontSize: 9 }}>corr 30d {dr.correlation30d >= 0 ? '+' : ''}{dr.correlation30d.toFixed(2)}</span>
            </span>
          </div>
        );
      })}
    </Section>
  );
}

// ── Main panel content ────────────────────────────────────────────────────────

/** Content-only component — rendered inside Panel base class's content div. */
export function GoldIntelligencePanelContent() {
  const { data, loading, error, refetch } = usePanelData<GoldIntelligenceData>(fetchGoldIntelligence, {
    ttlMs: 10 * 60 * 1000,
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
    <div style={{ padding: '10px 14px' }}>
      <HeaderSection d={data} />
      <ReturnsSection d={data} />
      <MetalsSection d={data} />
      <FxSection d={data} />
      {data.cot && <PositioningSection cot={data.cot} />}
      {data.etfFlows && <EtfSection f={data.etfFlows} />}
      {data.cbReserves && <CbReservesSection cb={data.cbReserves} />}
      <DriversSection drivers={data.drivers} />
    </div>
  );
}

export function GoldIntelligencePanel() {
  return (
    <PanelShell
      id="gold-intelligence"
      title={t('panels.goldIntelligence')}
      infoTooltip={t('components.goldIntelligence.infoTooltip')}
    >
      <GoldIntelligencePanelContent />
    </PanelShell>
  );
}
