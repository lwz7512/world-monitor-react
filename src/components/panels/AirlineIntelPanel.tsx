import { useState, useEffect, useRef, useCallback } from 'react';
import { PanelShell } from '@/components/PanelShell';
import {
  fetchAirportOpsSummary,
  fetchAirportFlights,
  fetchCarrierOps,
  fetchAircraftPositions,
  fetchFlightStatus,
  fetchAviationNews,
  fetchGoogleFlights,
  fetchGoogleDates,
  type AirportOpsSummary,
  type FlightInstance,
  type CarrierOps,
  type PositionSample,
  type AviationNewsItem,
  type FlightDelaySeverity,
  type GoogleFlightItinerary,
  type DatePrice,
} from '@/services/aviation';
import { aviationWatchlist } from '@/services/aviation/watchlist';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';

// ---- Helpers ----

const SEVERITY_COLOR: Record<FlightDelaySeverity, string> = {
  normal: 'var(--color-success, #22c55e)',
  minor: '#f59e0b',
  moderate: '#f97316',
  major: '#ef4444',
  severe: '#dc2626',
  unknown: '#9ca3af',
};

const STATUS_BADGE: Record<string, string> = {
  scheduled: '#6b7280', boarding: '#3b82f6', departed: '#8b5cf6',
  airborne: '#22c55e', landed: '#14b8a6', arrived: '#0ea5e9',
  cancelled: '#ef4444', diverted: '#f59e0b', unknown: '#6b7280',
};

function fmt(n: number | null | undefined): string { return n == null ? '—' : String(Math.round(n)); }
function fmtTime(dt: Date | null | undefined): string {
  if (!dt) return '—';
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtMin(m: number): string {
  if (!m) return '—';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TABS = ['ops', 'flights', 'airlines', 'tracking', 'news', 'prices'] as const;
type Tab = typeof TABS[number];

const TAB_LABELS: Record<Tab, string> = {
  ops: 'Ops', flights: 'Flights', airlines: 'Airlines',
  tracking: 'Track', news: 'News', prices: 'Prices',
};

function getWatchlistInit() {
  const wl = aviationWatchlist.get();
  const airports = wl.airports.slice(0, 8);
  const firstRoute = wl.routes[0];
  let origin = airports[0] ?? 'IST';
  let dest = airports[1] ?? '';
  if (firstRoute) {
    const parts = firstRoute.split('-');
    if (parts[0]) origin = parts[0];
    if (parts[1]) dest = parts[1];
  }
  return { airports, origin, dest };
}

// ---- Sub-components ----

function OpsTab({ data }: { data: AirportOpsSummary[] }) {
  if (!data.length) return <div className="no-data">{t('components.airlineIntel.noOpsData')}</div>;
  return (
    <div className="ops-grid">
      {data.map(s => (
        <div key={s.iata} className="ops-row">
          <div className="ops-iata">{s.iata}</div>
          <div className="ops-name">{s.name || s.iata}</div>
          <div className="ops-severity" style={{ color: SEVERITY_COLOR[s.severity] ?? '#aaa' }}>
            {s.severity.toUpperCase()}
          </div>
          <div className="ops-delay">{s.avgDelayMinutes > 0 ? `+${s.avgDelayMinutes}m` : '—'}</div>
          <div className="ops-cancel">{s.cancellationRate > 0 ? `${s.cancellationRate.toFixed(1)}% cxl` : ''}</div>
          {s.closureStatus && <div className="ops-closed">CLOSED</div>}
          {s.notamFlags.length > 0 && <div className="ops-notam">⚠️ NOTAM</div>}
        </div>
      ))}
    </div>
  );
}

function FlightsTab({ data }: { data: FlightInstance[] }) {
  if (!data.length) return <div className="no-data">{t('components.airlineIntel.noFlights')}</div>;
  return (
    <div className="flights-list">
      {data.map((f, i) => {
        const color = STATUS_BADGE[f.status] ?? '#6b7280';
        return (
          <div key={i} className="flight-row">
            <div className="flight-num">{f.flightNumber}</div>
            <div className="flight-route">{f.origin.iata} → {f.destination.iata}</div>
            <div className="flight-time">{fmtTime(f.scheduledDeparture)}</div>
            <div className="flight-delay" style={{ color: f.delayMinutes > 0 ? '#f97316' : '#aaa' }}>
              {f.delayMinutes > 0 ? `+${f.delayMinutes}m` : ''}
            </div>
            <div className="flight-status" style={{ color }}>{f.status}</div>
          </div>
        );
      })}
    </div>
  );
}

function AirlinesTab({ data }: { data: CarrierOps[] }) {
  if (!data.length) return <div className="no-data">{t('components.airlineIntel.noCarrierData')}</div>;
  return (
    <div className="carriers-list">
      {data.slice(0, 15).map((c, i) => (
        <div key={i} className="carrier-row">
          <div className="carrier-name">{c.carrierName || c.carrierIata}</div>
          <div className="carrier-flights">{c.totalFlights} flt</div>
          <div className="carrier-delay" style={{ color: c.delayPct > 30 ? '#ef4444' : '#aaa' }}>
            {c.delayPct.toFixed(1)}% delayed
          </div>
          <div className="carrier-cancel">{c.cancellationRate.toFixed(1)}% cxl</div>
        </div>
      ))}
    </div>
  );
}

function TrackingTab({
  loading, trackingData, trackingFlightData, trackingQuery,
  onQueryChange, onSearch, onClear,
}: {
  loading: boolean;
  trackingData: PositionSample[];
  trackingFlightData: FlightInstance[];
  trackingQuery: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="track-search" style={{ display: 'flex', gap: '6px', padding: '8px 0 6px' }}>
        <input
          className="price-input"
          placeholder="Flight (EK3) or callsign (UAE3)"
          value={trackingQuery}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSearch(); }}
          style={{ flex: 1, minWidth: 0 }}
        />
        {trackingQuery && (
          <button
            className="icon-btn"
            style={{ padding: '4px 8px', color: '#9ca3af' }}
            title="Back to live feed"
            onClick={onClear}
          >×</button>
        )}
        <button className="icon-btn" style={{ padding: '4px 10px' }} onClick={onSearch}>Track</button>
      </div>
      {loading && <div className="panel-loading">{t('common.loading')}</div>}
      {!loading && trackingFlightData.length > 0 && (
        <div>
          {trackingFlightData.map((f, i) => {
            const color = STATUS_BADGE[f.status] ?? '#6b7280';
            return (
              <div key={i} className="track-flight-card" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <strong>{f.flightNumber}</strong>
                  <span style={{ color: '#9ca3af', fontSize: '11px' }}>{f.carrier.name || f.carrier.iata}</span>
                  <span style={{ color, fontSize: '11px', marginLeft: 'auto' }}>{f.status}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                  {f.origin.iata} → {f.destination.iata}
                  {f.estimatedDeparture ? ` · Dep ${fmtTime(f.estimatedDeparture)}` : ''}
                  {f.estimatedArrival ? ` · Arr ${fmtTime(f.estimatedArrival)}` : ''}
                </div>
                {f.aircraftType && <div style={{ fontSize: '11px', color: '#6b7280' }}>{f.aircraftType}</div>}
                {(f.gate || f.terminal) && (
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>
                    {f.gate ? `Gate ${f.gate}` : ''}{f.terminal ? `${f.gate ? ' · ' : ''}T${f.terminal}` : ''}
                  </div>
                )}
                {f.delayMinutes > 0 && <div style={{ color: '#f97316', fontSize: '12px' }}>+{f.delayMinutes}m delay</div>}
              </div>
            );
          })}
        </div>
      )}
      {!loading && !trackingFlightData.length && trackingData.length > 0 && (
        <div className="tracking-list">
          {trackingData.slice(0, 20).map((p, i) => (
            <div key={i} className="track-row">
              <div className="track-cs">{p.callsign || p.icao24}</div>
              <div className="track-alt">{fmt(p.altitudeFt)} ft</div>
              <div className="track-spd">{fmt(p.groundSpeedKts)} kts</div>
              <div className="track-pos">{p.lat.toFixed(2)}, {p.lon.toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}
      {!loading && !trackingFlightData.length && !trackingData.length && (
        <div className="no-data">
          {trackingQuery
            ? <span>No results for <strong>{trackingQuery}</strong>.</span>
            : t('components.airlineIntel.noTrackingData')}
        </div>
      )}
    </div>
  );
}

function NewsTab({ data }: { data: AviationNewsItem[] }) {
  if (!data.length) return <div className="no-data">{t('components.airlineIntel.noNews')}</div>;
  return (
    <div className="news-list" style={{ padding: '0 4px' }}>
      {data.map((n, i) => (
        <div key={i} className="news-item" style={{ padding: '8px 0', borderBottom: '1px solid var(--border,#2a2a2a)' }}>
          <a href={sanitizeUrl(n.url)} target="_blank" rel="noopener" className="news-link">{n.title}</a>
          <div className="news-meta" style={{ fontSize: '11px', color: 'var(--text-dim,#888)', marginTop: '2px' }}>
            {n.sourceName} · {n.publishedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface PricesTabProps {
  pricesMode: 'search' | 'dates';
  onModeChange: (mode: 'search' | 'dates') => void;
  pricesOrigin: string; setOrigin: (v: string) => void;
  pricesDest: string; setDest: (v: string) => void;
  pricesDep: string; setDep: (v: string) => void;
  pricesCabin: string; setCabin: (v: string) => void;
  priceInlineErr: string;
  googleFlightsData: GoogleFlightItinerary[];
  pricesError: string;
  pricesDegraded: boolean;
  onFlightSearch: () => void;
  datesStart: string; setDatesStart: (v: string) => void;
  datesEnd: string; setDatesEnd: (v: string) => void;
  datesRoundTrip: boolean; setDatesRoundTrip: (v: boolean) => void;
  datesTripDuration: number; setDatesTripDuration: (v: number) => void;
  datesData: DatePrice[];
  datesInlineErr: string;
  onDatesSearch: () => void;
}

function PricesTab(props: PricesTabProps) {
  const isSearch = props.pricesMode === 'search';
  const dep = props.pricesDep || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return (
    <div>
      <div className="price-mode-toggle">
        <button
          className={`price-mode-btn${isSearch ? ' active' : ''}`}
          onClick={() => { props.onModeChange('search'); }}
        >{t('components.airlineIntel.searchFlights')}</button>
        <button
          className={`price-mode-btn${!isSearch ? ' active' : ''}`}
          onClick={() => { props.onModeChange('dates'); }}
        >{t('components.airlineIntel.bestDates')}</button>
      </div>
      {props.pricesDegraded && (
        <div className="gf-degraded">{t('components.airlineIntel.degradedResults')}</div>
      )}
      {isSearch ? (
        <>
          <div className="price-controls">
            <input className="price-input" placeholder="From" maxLength={3}
              value={props.pricesOrigin} onChange={e => props.setOrigin(e.target.value.toUpperCase())}
              style={{ width: '54px' }} />
            <span style={{ color: '#6b7280' }}>→</span>
            <input className="price-input" placeholder="To" maxLength={3}
              value={props.pricesDest} onChange={e => props.setDest(e.target.value.toUpperCase())}
              style={{ width: '54px' }} />
            <input className="price-input" type="date" value={dep}
              onChange={e => props.setDep(e.target.value)} style={{ width: '128px' }} />
            <select className="price-input" value={props.pricesCabin}
              onChange={e => props.setCabin(e.target.value)} style={{ width: '110px' }}>
              <option value="ECONOMY">Economy</option>
              <option value="PREMIUM_ECONOMY">Premium Economy</option>
              <option value="BUSINESS">Business</option>
              <option value="FIRST">First</option>
            </select>
            <button className="icon-btn" style={{ padding: '4px 10px' }} onClick={props.onFlightSearch}>
              {t('header.search')}
            </button>
          </div>
          <div style={{ color: '#ef4444', fontSize: '11px', minHeight: '14px' }}>{props.priceInlineErr}</div>
          {props.googleFlightsData.length > 0 ? (
            <div className="gf-list">
              {props.googleFlightsData.map((it, i) => {
                const stops = it.stops === 0 ? t('components.airlineIntel.nonstop') : `${it.stops} stop`;
                return (
                  <div key={i} className="gf-card">
                    <div className="gf-summary">
                      <span className="gf-price">{Math.round(it.price).toLocaleString()}</span>
                      <span className="gf-total-dur">{fmtMin(it.durationMinutes)}</span>
                      <span className="gf-stops">{stops}</span>
                    </div>
                    {it.legs.map((leg, j) => (
                      <div key={j} className="gf-leg">
                        <span className="gf-airline">{leg.airlineCode} {leg.flightNumber}</span>
                        <span>{leg.departureAirport} {leg.departureDatetime.slice(11, 16)}</span>
                        <span>→</span>
                        <span>{leg.arrivalAirport} {leg.arrivalDatetime.slice(11, 16)}</span>
                        <span className="gf-dur">({fmtMin(leg.durationMinutes)})</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : props.pricesError ? (
            <div className="no-data" style={{ color: '#ef4444' }}>{props.pricesError}</div>
          ) : (
            <div className="no-data">{t('components.airlineIntel.enterRouteAndDate')}</div>
          )}
        </>
      ) : (
        <>
          <div className="price-controls">
            <input className="price-input" placeholder="From" maxLength={3}
              value={props.pricesOrigin} onChange={e => props.setOrigin(e.target.value.toUpperCase())}
              style={{ width: '54px' }} />
            <span style={{ color: '#6b7280' }}>→</span>
            <input className="price-input" placeholder="To" maxLength={3}
              value={props.pricesDest} onChange={e => props.setDest(e.target.value.toUpperCase())}
              style={{ width: '54px' }} />
            <input className="price-input" type="date" value={props.datesStart || localDateStr()}
              onChange={e => props.setDatesStart(e.target.value)} style={{ width: '128px' }} />
            <input className="price-input" type="date" value={props.datesEnd}
              onChange={e => props.setDatesEnd(e.target.value)} style={{ width: '128px' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              <input type="checkbox" checked={props.datesRoundTrip}
                onChange={e => props.setDatesRoundTrip(e.target.checked)} />
              {t('components.airlineIntel.roundTrip')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
              {t('components.airlineIntel.tripDays')}:
              <input className="price-input" type="number" min={1} value={props.datesTripDuration}
                onChange={e => props.setDatesTripDuration(parseInt(e.target.value, 10) || 7)}
                style={{ width: '44px' }} />
            </label>
            <select className="price-input" value={props.pricesCabin}
              onChange={e => props.setCabin(e.target.value)} style={{ width: '110px' }}>
              <option value="ECONOMY">Economy</option>
              <option value="PREMIUM_ECONOMY">Premium Economy</option>
              <option value="BUSINESS">Business</option>
              <option value="FIRST">First</option>
            </select>
            <button className="icon-btn" style={{ padding: '4px 10px' }} onClick={props.onDatesSearch}>
              {t('header.search')}
            </button>
          </div>
          <div style={{ color: '#ef4444', fontSize: '11px', minHeight: '14px' }}>{props.datesInlineErr}</div>
          {props.datesData.length > 0 ? (
            <DatesResults datesData={props.datesData} />
          ) : props.pricesError ? (
            <div className="no-data" style={{ color: '#ef4444' }}>{props.pricesError}</div>
          ) : (
            <div className="no-data">{t('components.airlineIntel.enterDateRange')}</div>
          )}
        </>
      )}
    </div>
  );
}

function DatesResults({ datesData }: { datesData: DatePrice[] }) {
  const sorted = [...datesData].sort((a, b) => a.price - b.price);
  const prices = sorted.map(d => d.price);
  const cheapThreshold = prices[Math.floor(prices.length * 0.2)] ?? Infinity;
  const expThreshold = prices[Math.floor(prices.length * 0.8)] ?? -Infinity;
  return (
    <div className="dp-list">
      {sorted.map((d, i) => {
        const cls = d.price <= cheapThreshold ? 'dp-cheap' : d.price >= expThreshold ? 'dp-expensive' : '';
        return (
          <div key={i} className="dp-row">
            <span className="dp-date">{d.date}</span>
            {d.returnDate && <span className="dp-return">{d.returnDate}</span>}
            <span className={`dp-price ${cls}`}>{Math.round(d.price).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---- Main component ----

export function AirlineIntelPanelContent() {
  const [{ airports, origin: initOrigin, dest: initDest }] = useState(getWatchlistInit);

  const [activeTab, setActiveTab] = useState<Tab>('ops');
  const [loading, setLoading] = useState(false);
  const [opsData, setOpsData] = useState<AirportOpsSummary[]>([]);
  const [flightsData, setFlightsData] = useState<FlightInstance[]>([]);
  const [carriersData, setCarriersData] = useState<CarrierOps[]>([]);
  const [trackingData, setTrackingData] = useState<PositionSample[]>([]);
  const [trackingFlightData, setTrackingFlightData] = useState<FlightInstance[]>([]);
  const [trackingQuery, setTrackingQuery] = useState('');
  const [newsData, setNewsData] = useState<AviationNewsItem[]>([]);
  const [googleFlightsData, setGoogleFlightsData] = useState<GoogleFlightItinerary[]>([]);
  const [datesData, setDatesData] = useState<DatePrice[]>([]);
  const [pricesMode, setPricesMode] = useState<'search' | 'dates'>('search');
  const [pricesCabin, setPricesCabin] = useState('ECONOMY');
  const [pricesDegraded, setPricesDegraded] = useState(false);
  const [pricesError, setPricesError] = useState('');
  const [pricesOrigin, setPricesOrigin] = useState(initOrigin);
  const [pricesDest, setPricesDest] = useState(initDest);
  const [pricesDep, setPricesDep] = useState('');
  const [datesStart, setDatesStart] = useState('');
  const [datesEnd, setDatesEnd] = useState('');
  const [datesTripDuration, setDatesTripDuration] = useState(7);
  const [datesRoundTrip, setDatesRoundTrip] = useState(true);
  const [priceInlineErr, setPriceInlineErr] = useState('');
  const [datesInlineErr, setDatesInlineErr] = useState('');

  // Refs for use inside interval/callbacks (avoid stale closures)
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const trackingQueryRef = useRef(trackingQuery);
  trackingQueryRef.current = trackingQuery;
  const airportsRef = useRef(airports);
  airportsRef.current = airports;

  const loadOpsAsync = useCallback(async () => {
    try {
      const data = await fetchAirportOpsSummary(airportsRef.current);
      setOpsData(data);
    } catch { /* silent */ }
  }, []);

  const loadTabAsync = useCallback(async (tab: Tab, queryOverride?: string) => {
    setLoading(true);
    try {
      switch (tab) {
        case 'ops': {
          const data = await fetchAirportOpsSummary(airportsRef.current);
          setOpsData(data);
          break;
        }
        case 'flights': {
          const data = await fetchAirportFlights(airportsRef.current[0] ?? 'IST', 'both', 30);
          setFlightsData(data);
          break;
        }
        case 'airlines': {
          const data = await fetchCarrierOps(airportsRef.current);
          setCarriersData(data);
          break;
        }
        case 'tracking': {
          const q = queryOverride !== undefined ? queryOverride : trackingQueryRef.current;
          if (q) {
            if (/^[A-Z]{2}\d{1,4}$/.test(q)) {
              const data = await fetchFlightStatus(q);
              setTrackingFlightData(data);
            } else if (/^[0-9A-F]{6}$/i.test(q)) {
              const data = await fetchAircraftPositions({ icao24: q.toLowerCase() });
              setTrackingData(data);
            } else {
              const data = await fetchAircraftPositions({ callsign: q });
              setTrackingData(data);
            }
          } else {
            const data = await fetchAircraftPositions({});
            setTrackingData(data);
          }
          break;
        }
        case 'news': {
          const entities = [...airportsRef.current, ...aviationWatchlist.get().airlines];
          const data = await fetchAviationNews(entities, 24, 20);
          setNewsData(data);
          break;
        }
        case 'prices':
          // Never auto-fetch — only on explicit search
          break;
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  const handleRefresh = useCallback(() => {
    const tab = activeTabRef.current;
    if (tab !== 'ops') void loadOpsAsync();
    if (tab !== 'prices') void loadTabAsync(tab);
  }, [loadOpsAsync, loadTabAsync]);

  // Mount: initial load + 5-min refresh interval
  useEffect(() => {
    void loadOpsAsync();
    void loadTabAsync('ops');
    const id = setInterval(handleRefresh, 5 * 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTabSwitch(tab: Tab) {
    setActiveTab(tab);
    if (
      (tab === 'ops' && !opsData.length) ||
      (tab === 'flights' && !flightsData.length) ||
      (tab === 'airlines' && !carriersData.length) ||
      (tab === 'tracking' && !trackingData.length) ||
      (tab === 'news' && !newsData.length)
    ) {
      void loadTabAsync(tab);
    }
  }

  function handleTrackSearch() {
    const q = trackingQuery.toUpperCase().trim();
    trackingQueryRef.current = q;
    setTrackingQuery(q);
    setTrackingFlightData([]);
    setTrackingData([]);
    void loadTabAsync('tracking', q);
  }

  function handleTrackClear() {
    trackingQueryRef.current = '';
    setTrackingQuery('');
    setTrackingFlightData([]);
    setTrackingData([]);
    void loadTabAsync('tracking', '');
  }

  function handleFlightSearch() {
    const iataRe = /^[A-Z]{3}$/;
    if (!iataRe.test(pricesOrigin) || !iataRe.test(pricesDest)) {
      setPriceInlineErr('Enter valid 3-letter IATA codes');
      return;
    }
    const dep = pricesDep || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    if (dep < localDateStr()) {
      setPriceInlineErr('Departure date must be today or future');
      return;
    }
    setPriceInlineErr('');
    void (async () => {
      setLoading(true);
      try {
        const r = await fetchGoogleFlights({
          origin: pricesOrigin, destination: pricesDest,
          departureDate: dep, cabinClass: pricesCabin,
        });
        setGoogleFlightsData(r.flights);
        setPricesDegraded(r.degraded);
        setPricesError(r.error);
      } catch { /* silent */ }
      setLoading(false);
    })();
  }

  function handleDatesSearch() {
    const iataRe = /^[A-Z]{3}$/;
    if (!iataRe.test(pricesOrigin) || !iataRe.test(pricesDest)) {
      setDatesInlineErr('Enter valid 3-letter IATA codes');
      return;
    }
    if (!datesStart || !datesEnd) {
      setDatesInlineErr('Enter start and end dates');
      return;
    }
    if (datesStart < localDateStr()) {
      setDatesInlineErr('Start date must be today or future');
      return;
    }
    if (datesStart >= datesEnd) {
      setDatesInlineErr('Start date must be before end date');
      return;
    }
    if (datesRoundTrip && (Number.isNaN(datesTripDuration) || datesTripDuration < 1)) {
      setDatesInlineErr('Trip duration must be at least 1 day');
      return;
    }
    const daysDiff = (new Date(datesEnd).getTime() - new Date(datesStart).getTime()) / 86400000;
    setDatesInlineErr(daysDiff > 90 ? 'Range exceeds 90 days — results may be incomplete' : '');
    void (async () => {
      setLoading(true);
      try {
        const r = await fetchGoogleDates({
          origin: pricesOrigin, destination: pricesDest,
          startDate: datesStart, endDate: datesEnd,
          tripDuration: datesTripDuration, isRoundTrip: datesRoundTrip,
          cabinClass: pricesCabin,
        });
        setDatesData(r.dates);
        setPricesDegraded(r.degraded);
        setPricesError(r.error);
      } catch { /* silent */ }
      setLoading(false);
    })();
  }

  return (
    <div className="airline-intel-content">
      <div className="panel-tabs">
        {TABS.map(tab => (
          <button
            key={tab}
            className={`panel-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => handleTabSwitch(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      {loading && activeTab !== 'tracking' && activeTab !== 'prices' && (
        <div className="panel-loading">{t('common.loading')}</div>
      )}
      {(!loading || activeTab === 'tracking' || activeTab === 'prices') && (
        <>
          {activeTab === 'ops' && <OpsTab data={opsData} />}
          {activeTab === 'flights' && <FlightsTab data={flightsData} />}
          {activeTab === 'airlines' && <AirlinesTab data={carriersData} />}
          {activeTab === 'tracking' && (
            <TrackingTab
              loading={loading}
              trackingData={trackingData}
              trackingFlightData={trackingFlightData}
              trackingQuery={trackingQuery}
              onQueryChange={q => { setTrackingQuery(q); trackingQueryRef.current = q; }}
              onSearch={handleTrackSearch}
              onClear={handleTrackClear}
            />
          )}
          {activeTab === 'news' && <NewsTab data={newsData} />}
          {activeTab === 'prices' && (
            <PricesTab
              pricesMode={pricesMode}
              onModeChange={mode => { setPricesMode(mode); setPricesError(''); setPricesDegraded(false); }}
              pricesOrigin={pricesOrigin} setOrigin={setPricesOrigin}
              pricesDest={pricesDest} setDest={setPricesDest}
              pricesDep={pricesDep} setDep={setPricesDep}
              pricesCabin={pricesCabin} setCabin={setPricesCabin}
              priceInlineErr={priceInlineErr}
              googleFlightsData={googleFlightsData}
              pricesError={pricesError}
              pricesDegraded={pricesDegraded}
              onFlightSearch={handleFlightSearch}
              datesStart={datesStart} setDatesStart={setDatesStart}
              datesEnd={datesEnd} setDatesEnd={setDatesEnd}
              datesRoundTrip={datesRoundTrip} setDatesRoundTrip={setDatesRoundTrip}
              datesTripDuration={datesTripDuration} setDatesTripDuration={setDatesTripDuration}
              datesData={datesData}
              datesInlineErr={datesInlineErr}
              onDatesSearch={handleDatesSearch}
            />
          )}
        </>
      )}
    </div>
  );
}

export function AirlineIntelPanel() {
  return (
    <PanelShell
      id="airline-intel"
      title={t('panels.airlineIntel')}
      infoTooltip={t('components.airlineIntel.infoTooltip')}
    >
      <AirlineIntelPanelContent />
    </PanelShell>
  );
}
