import { usePanelData } from '@/hooks/usePanelData';
import { toApiUrl } from '@/services/runtime';
import { PanelShell } from '@/components/PanelShell';

export interface WeekData {
  date: string;
  bullish: number;
  bearish: number;
  neutral: number;
  spread: number;
}

export interface AAIIData {
  seededAt: string;
  fallback?: boolean;
  source: string;
  latest: WeekData;
  previous: WeekData | null;
  avg8w: { bullish: number; bearish: number; neutral: number; spread: number } | null;
  historicalAvg: { bullish: number; bearish: number; neutral: number };
  extremes: { spreadBelow20: number; bullishAbove50: number; bearishAbove50: number };
  weeks: WeekData[];
}

function spreadColor(spread: number): string {
  if (spread <= -20) return '#e74c3c';
  if (spread <= -10) return '#e67e22';
  if (spread < 0) return '#f39c12';
  if (spread < 10) return '#95a5a6';
  if (spread < 20) return '#27ae60';
  return '#2ecc71';
}

function sentimentLabel(spread: number): string {
  if (spread <= -20) return 'Extreme Bearish';
  if (spread <= -10) return 'Bearish';
  if (spread < 0) return 'Mildly Bearish';
  if (spread < 10) return 'Neutral';
  if (spread < 20) return 'Bullish';
  return 'Extreme Bullish';
}

function Bar({ pct, color, label, value }: { pct: number; color: string; label: string; value: string }) {
  return (
    <div style={{ margin: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{value}</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3 }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

function SpreadBar({ spread }: { spread: number }) {
  const color = spreadColor(spread);
  const clamped = Math.max(-60, Math.min(60, spread));
  const barWidth = Math.abs(clamped) / 60 * 50;
  const leftPct = clamped >= 0 ? 50 : 50 - barWidth;
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 3 }}>
        <span>Bull-Bear Spread</span>
        <span style={{ color, fontWeight: 700 }}>{clamped >= 0 ? '+' : ''}{spread.toFixed(1)}%</span>
      </div>
      <div style={{ position: 'relative', height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }}>
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(255,255,255,0.2)' }} />
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${leftPct.toFixed(1)}%`, width: `${barWidth.toFixed(1)}%`,
          background: color, borderRadius: 3, transition: 'all 0.3s',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>
        <span>Bearish</span>
        <span>Bullish</span>
      </div>
    </div>
  );
}

function SparkChart({ weeks }: { weeks: WeekData[] }) {
  if (weeks.length < 2) return null;
  const data = [...weeks].reverse();
  const W = 280, H = 60, PAD = 4;
  const spreads = data.map(w => w.spread);
  const maxAbs = Math.max(Math.abs(Math.min(...spreads)), Math.abs(Math.max(...spreads)), 20);
  const stepX = (W - PAD * 2) / (data.length - 1);
  const midY = H / 2;
  const scaleY = (midY - PAD) / maxAbs;

  const points = data.map((w, i) => `${(PAD + i * stepX).toFixed(1)},${(midY - w.spread * scaleY).toFixed(1)}`).join(' ');
  const contrarian = midY + 20 * scaleY;

  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        52-Week Spread History
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block' }}>
        {data.map((w, i) => {
          const x = PAD + i * stepX - 1;
          const barH = Math.abs(w.spread) * scaleY;
          const y = w.spread >= 0 ? midY - barH : midY;
          return (
            <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width="2" height={barH.toFixed(1)}
              fill={w.spread >= 0 ? 'rgba(39,174,96,0.25)' : 'rgba(231,76,60,0.25)'} rx="0.5" />
          );
        })}
        <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" strokeDasharray="3,3" />
        <line x1={PAD} y1={contrarian.toFixed(1)} x2={W - PAD} y2={contrarian.toFixed(1)} stroke="rgba(231,76,60,0.3)" strokeWidth="0.5" strokeDasharray="2,4" />
        <text x={W - PAD} y={(contrarian - 2).toFixed(1)} textAnchor="end" fontSize="7" fill="rgba(231,76,60,0.5)" fontFamily="system-ui,sans-serif">
          -20 buy signal
        </text>
        <polyline points={points} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

async function fetchAAIIData(signal: AbortSignal): Promise<AAIIData> {
  const resp = await fetch(toApiUrl('/api/bootstrap?keys=aaiiSentiment'), { signal });
  if (!resp.ok) throw new Error('AAII sentiment data unavailable');
  const { data } = await resp.json() as { data: { aaiiSentiment?: AAIIData } };
  if (!data.aaiiSentiment?.latest) throw new Error('No AAII data in response');
  return data.aaiiSentiment;
}

/** Content-only component — rendered inside Panel base class's content div. */
export function AAIISentimentPanelContent() {
  const { data, loading, error, refetch } = usePanelData<AAIIData>(fetchAAIIData, {
    hydrationKey: 'aaiiSentiment',
  });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">Loading…</div>
      </div>
    );
  }

  if (error || !data?.latest) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? 'No data available'}</div>
        <button className="panel-error-retry" data-panel-retry onClick={refetch}>Retry</button>
      </div>
    );
  }

  const { latest, previous, avg8w, historicalAvg, extremes, weeks, fallback, source } = data;
  const color = spreadColor(latest.spread);
  const label = sentimentLabel(latest.spread);
  const spreadDelta = previous != null ? latest.spread - previous.spread : null;

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</div>
        {spreadDelta != null && (
          <div style={{ marginTop: 2 }}>
            <span style={{ color: spreadDelta >= 0 ? '#2ecc71' : '#e74c3c', fontSize: 10, marginLeft: 4 }}>
              {spreadDelta >= 0 ? '+' : ''}{spreadDelta.toFixed(1)} vs prev
            </span>
          </div>
        )}
      </div>

      {latest.spread <= -20 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', margin: '8px 0', borderRadius: 4, border: '1px solid #2ecc71', background: 'rgba(46,204,113,0.08)', fontSize: 10, color: '#2ecc71' }}>
          &#9432; Contrarian buy signal active: spread at {latest.spread.toFixed(1)}% (threshold: -20%)
        </div>
      )}
      {latest.spread > -20 && latest.bearish >= 50 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', margin: '8px 0', borderRadius: 4, border: '1px solid #e67e22', background: 'rgba(230,126,34,0.08)', fontSize: 10, color: '#e67e22' }}>
          &#9888; Extreme bearish reading: {latest.bearish.toFixed(1)}% bearish (avg: {historicalAvg.bearish}%)
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, textAlign: 'center', padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#2ecc71' }}>{latest.bullish.toFixed(1)}%</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Bullish</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>avg {historicalAvg.bullish}%</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#95a5a6' }}>{latest.neutral.toFixed(1)}%</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Neutral</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>avg {historicalAvg.neutral}%</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#e74c3c' }}>{latest.bearish.toFixed(1)}%</div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>Bearish</div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>avg {historicalAvg.bearish}%</div>
        </div>
      </div>

      <Bar pct={latest.bullish} color="#2ecc71" label="Bullish" value={`${latest.bullish.toFixed(1)}%`} />
      <Bar pct={latest.neutral} color="#95a5a6" label="Neutral" value={`${latest.neutral.toFixed(1)}%`} />
      <Bar pct={latest.bearish} color="#e74c3c" label="Bearish" value={`${latest.bearish.toFixed(1)}%`} />

      <SpreadBar spread={latest.spread} />
      <SparkChart weeks={weeks} />

      {avg8w && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>8-Week Moving Average</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, textAlign: 'center' }}>
            <div><div style={{ fontSize: 14, fontWeight: 600, color: '#2ecc71' }}>{avg8w.bullish}%</div><div style={{ fontSize: 9, color: 'var(--text-dim)' }}>Bull</div></div>
            <div><div style={{ fontSize: 14, fontWeight: 600, color: '#95a5a6' }}>{avg8w.neutral}%</div><div style={{ fontSize: 9, color: 'var(--text-dim)' }}>Neutral</div></div>
            <div><div style={{ fontSize: 14, fontWeight: 600, color: '#e74c3c' }}>{avg8w.bearish}%</div><div style={{ fontSize: 9, color: 'var(--text-dim)' }}>Bear</div></div>
          </div>
        </div>
      )}

      {(extremes.spreadBelow20 > 0 || extremes.bearishAbove50 > 0) && (
        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-dim)' }}>
          52w extremes: {extremes.spreadBelow20} contrarian signals, {extremes.bearishAbove50} extreme bear, {extremes.bullishAbove50} extreme bull
        </div>
      )}

      {latest.date && (
        <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'right', marginTop: 4 }}>
          Survey: {latest.date}{source !== 'xls' ? ` (${source})` : ''}
          {fallback && <span style={{ display: 'inline-block', padding: '1px 5px', borderRadius: 3, background: 'rgba(230,126,34,0.15)', color: '#e67e22', fontSize: 9, marginLeft: 4 }}>(fallback data)</span>}
        </div>
      )}
    </div>
  );
}

export function AAIISentimentPanel() {
  return (
    <PanelShell
      id="aaii-sentiment"
      title="AAII Investor Sentiment"
      infoTooltip="Weekly AAII survey: individual investors report 6-month market outlook as bullish, neutral, or bearish. Spread below -20 is a historical contrarian buy signal."
    >
      <AAIISentimentPanelContent />
    </PanelShell>
  );
}
