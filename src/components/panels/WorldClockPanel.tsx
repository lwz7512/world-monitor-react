import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { t, getLocale } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

interface CityEntry {
  id: string;
  city: string;
  label: string;
  timezone: string;
  marketOpen?: number;
  marketClose?: number;
}

const WORLD_CITIES: CityEntry[] = [
  { id: 'new-york', city: 'New York', label: 'NYSE', timezone: 'America/New_York', marketOpen: 9, marketClose: 16 },
  { id: 'chicago', city: 'Chicago', label: 'CME', timezone: 'America/Chicago', marketOpen: 8, marketClose: 15 },
  { id: 'sao-paulo', city: 'São Paulo', label: 'B3', timezone: 'America/Sao_Paulo', marketOpen: 10, marketClose: 17 },
  { id: 'london', city: 'London', label: 'LSE', timezone: 'Europe/London', marketOpen: 8, marketClose: 16 },
  { id: 'paris', city: 'Paris', label: 'Euronext', timezone: 'Europe/Paris', marketOpen: 9, marketClose: 17 },
  { id: 'frankfurt', city: 'Frankfurt', label: 'XETRA', timezone: 'Europe/Berlin', marketOpen: 9, marketClose: 17 },
  { id: 'zurich', city: 'Zurich', label: 'SIX', timezone: 'Europe/Zurich', marketOpen: 9, marketClose: 17 },
  { id: 'moscow', city: 'Moscow', label: 'MOEX', timezone: 'Europe/Moscow', marketOpen: 10, marketClose: 18 },
  { id: 'istanbul', city: 'Istanbul', label: 'BIST', timezone: 'Europe/Istanbul', marketOpen: 10, marketClose: 18 },
  { id: 'riyadh', city: 'Riyadh', label: 'Tadawul', timezone: 'Asia/Riyadh', marketOpen: 10, marketClose: 15 },
  { id: 'dubai', city: 'Dubai', label: 'DFM', timezone: 'Asia/Dubai', marketOpen: 10, marketClose: 14 },
  { id: 'mumbai', city: 'Mumbai', label: 'NSE', timezone: 'Asia/Kolkata', marketOpen: 9, marketClose: 15 },
  { id: 'bangkok', city: 'Bangkok', label: 'SET', timezone: 'Asia/Bangkok', marketOpen: 10, marketClose: 16 },
  { id: 'singapore', city: 'Singapore', label: 'SGX', timezone: 'Asia/Singapore', marketOpen: 9, marketClose: 17 },
  { id: 'hong-kong', city: 'Hong Kong', label: 'HKEX', timezone: 'Asia/Hong_Kong', marketOpen: 9, marketClose: 16 },
  { id: 'shanghai', city: 'Shanghai', label: 'SSE', timezone: 'Asia/Shanghai', marketOpen: 9, marketClose: 15 },
  { id: 'seoul', city: 'Seoul', label: 'KRX', timezone: 'Asia/Seoul', marketOpen: 9, marketClose: 15 },
  { id: 'tokyo', city: 'Tokyo', label: 'TSE', timezone: 'Asia/Tokyo', marketOpen: 9, marketClose: 15 },
  { id: 'sydney', city: 'Sydney', label: 'ASX', timezone: 'Australia/Sydney', marketOpen: 10, marketClose: 16 },
  { id: 'auckland', city: 'Auckland', label: 'NZX', timezone: 'Pacific/Auckland', marketOpen: 10, marketClose: 16 },
  { id: 'toronto', city: 'Toronto', label: 'TSX', timezone: 'America/Toronto', marketOpen: 9, marketClose: 16 },
  { id: 'mexico-city', city: 'Mexico City', label: 'BMV', timezone: 'America/Mexico_City', marketOpen: 8, marketClose: 15 },
  { id: 'buenos-aires', city: 'Buenos Aires', label: 'BYMA', timezone: 'America/Argentina/Buenos_Aires', marketOpen: 11, marketClose: 17 },
  { id: 'johannesburg', city: 'Johannesburg', label: 'JSE', timezone: 'Africa/Johannesburg', marketOpen: 9, marketClose: 17 },
  { id: 'cairo', city: 'Cairo', label: 'EGX', timezone: 'Africa/Cairo', marketOpen: 10, marketClose: 14 },
  { id: 'lagos', city: 'Lagos', label: 'NGX', timezone: 'Africa/Lagos', marketOpen: 10, marketClose: 14 },
  { id: 'los-angeles', city: 'Los Angeles', label: 'Pacific', timezone: 'America/Los_Angeles' },
  { id: 'jakarta', city: 'Jakarta', label: 'IDX', timezone: 'Asia/Jakarta', marketOpen: 9, marketClose: 16 },
  { id: 'taipei', city: 'Taipei', label: 'TWSE', timezone: 'Asia/Taipei', marketOpen: 9, marketClose: 13 },
  { id: 'kuala-lumpur', city: 'Kuala Lumpur', label: 'Bursa', timezone: 'Asia/Kuala_Lumpur', marketOpen: 9, marketClose: 17 },
];

const CITY_REGIONS: { name: string; ids: string[] }[] = [
  { name: 'Americas', ids: ['new-york', 'chicago', 'toronto', 'los-angeles', 'mexico-city', 'sao-paulo', 'buenos-aires'] },
  { name: 'Europe', ids: ['london', 'paris', 'frankfurt', 'zurich', 'moscow', 'istanbul'] },
  { name: 'Middle East & Africa', ids: ['riyadh', 'dubai', 'cairo', 'lagos', 'johannesburg'] },
  { name: 'Asia-Pacific', ids: ['mumbai', 'bangkok', 'jakarta', 'kuala-lumpur', 'singapore', 'hong-kong', 'shanghai', 'taipei', 'seoul', 'tokyo', 'sydney', 'auckland'] },
];

const TIMEZONE_TO_CITY: Record<string, string> = {};
for (const c of WORLD_CITIES) TIMEZONE_TO_CITY[c.timezone] = c.id;
TIMEZONE_TO_CITY['America/Detroit'] = 'new-york';
TIMEZONE_TO_CITY['US/Eastern'] = 'new-york';
TIMEZONE_TO_CITY['US/Central'] = 'chicago';
TIMEZONE_TO_CITY['US/Pacific'] = 'los-angeles';
TIMEZONE_TO_CITY['US/Mountain'] = 'new-york';
TIMEZONE_TO_CITY['Asia/Calcutta'] = 'mumbai';
TIMEZONE_TO_CITY['Asia/Saigon'] = 'bangkok';
TIMEZONE_TO_CITY['Pacific/Sydney'] = 'sydney';

const STORAGE_KEY = 'worldmonitor-world-clock-cities';
const DEFAULT_CITIES = ['new-york', 'london', 'dubai', 'bangkok', 'tokyo', 'sydney'];

function detectHomeCity(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONE_TO_CITY[tz] ?? null;
  } catch {
    return null;
  }
}

function loadSelectedCities(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  const home = detectHomeCity();
  const defaults = [...DEFAULT_CITIES];
  if (home && !defaults.includes(home)) defaults.unshift(home);
  return defaults;
}

function saveSelectedCities(ids: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function getTimeInZone(tz: string): { h: number; m: number; s: number; dayOfWeek: string } {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat(getLocale(), {
      timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false, weekday: 'short', numberingSystem: 'latn',
    }).formatToParts(now);
    let h = 0, m = 0, s = 0, dayOfWeek = '';
    for (const p of parts) {
      if (p.type === 'hour') h = parseInt(p.value, 10);
      if (p.type === 'minute') m = parseInt(p.value, 10);
      if (p.type === 'second') s = parseInt(p.value, 10);
      if (p.type === 'weekday') dayOfWeek = p.value;
    }
    if (h === 24) h = 0;
    return { h, m, s, dayOfWeek };
  } catch {
    return { h: 0, m: 0, s: 0, dayOfWeek: '' };
  }
}

function getTzAbbr(tz: string): string {
  try {
    const fmt = new Intl.DateTimeFormat(getLocale(), { timeZone: tz, timeZoneName: 'short' });
    const parts = fmt.formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart?.value ?? '';
  } catch {
    return '';
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function CityRow({ city, isHome, tick }: { city: CityEntry; isHome: boolean; tick: number }) {
  void tick;
  const { h, m, s, dayOfWeek } = getTimeInZone(city.timezone);
  const isDay = h >= 6 && h < 20;
  const pct = ((h * 3600 + m * 60 + s) / 86400) * 100;
  const abbr = getTzAbbr(city.timezone);
  const isWeekday = dayOfWeek !== 'Sat' && dayOfWeek !== 'Sun';

  let statusEl: ReactNode = null;
  if (city.marketOpen !== undefined && city.marketClose !== undefined) {
    const isOpen = isWeekday && h >= city.marketOpen && h < city.marketClose;
    statusEl = isOpen
      ? <span className="wc-status open"><span className="wc-dot open" />OPEN</span>
      : <span className="wc-status closed"><span className="wc-dot closed" />CLSD</span>;
  }

  const rowCls = ['wc-row', isHome ? 'wc-home' : '', !isDay ? 'wc-night' : ''].filter(Boolean).join(' ');

  return (
    <div className={rowCls} data-city-id={city.id}>
      <div className="wc-drag-handle" title="Drag to reorder">⋮</div>
      <div className="wc-info">
        <div className="wc-name">
          {city.city}
          {isHome && <span className="wc-home-tag">⌂</span>}
        </div>
        <div className="wc-detail">
          <span className="wc-exchange">{city.label}</span>
          {statusEl}
        </div>
      </div>
      <div className="wc-clock">
        <div className="wc-time">{pad2(h)}:{pad2(m)}:{pad2(s)}</div>
        <div className="wc-tz">
          <div className="wc-bar-wrap">
            <div className={`wc-bar ${isDay ? 'day' : 'night'}`} style={{ width: `${pct.toFixed(1)}%` }} />
          </div>
          <span>{dayOfWeek} {abbr}</span>
        </div>
      </div>
    </div>
  );
}

export function WorldClockPanelContent() {
  const [selectedCities, setSelectedCities] = useState<string[]>(loadSelectedCities);
  const [showSettings, setShowSettings] = useState(false);
  const [tick, setTick] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragStartY, setDragStartY] = useState(0);

  const homeCityId = detectHomeCity();

  useEffect(() => {
    if (showSettings) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [showSettings]);

  const toggleCity = useCallback((cityId: string, checked: boolean) => {
    setSelectedCities(prev => {
      const next = checked ? [...prev, cityId] : prev.filter(id => id !== cityId);
      saveSelectedCities(next);
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent, cityId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragId(cityId);
    setDragStartY(e.clientY);
  }, []);

  const handleDrop = useCallback((targetId: string, insertBefore: boolean) => {
    if (!dragId || targetId === dragId) return;
    setSelectedCities(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(dragId);
      if (fromIdx === -1) return prev;
      next.splice(fromIdx, 1);
      let toIdx = next.indexOf(targetId);
      if (!insertBefore) toIdx++;
      next.splice(toIdx, 0, dragId);
      saveSelectedCities(next);
      return next;
    });
    setDragId(null);
  }, [dragId]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragId) return;
    if (Math.abs(e.clientY - dragStartY) < 8) return;
    e.preventDefault();
  }, [dragId, dragStartY]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragId) return;
    const container = (e.currentTarget as HTMLElement);
    const rows = container.querySelectorAll<HTMLElement>('.wc-row[data-city-id]');
    let targetId: string | null = null;
    let insertBefore = true;
    for (const row of rows) {
      if (row.dataset.cityId === dragId) continue;
      const rect = row.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetId = row.dataset.cityId ?? null;
        insertBefore = e.clientY < rect.top + rect.height / 2;
        break;
      }
    }
    if (targetId) handleDrop(targetId, insertBefore);
    else setDragId(null);
  }, [dragId, handleDrop]);

  const cityList = selectedCities
    .map(id => WORLD_CITIES.find(c => c.id === id))
    .filter((c): c is CityEntry => !!c);

  if (showSettings) {
    return (
      <div className="wc-settings-view">
        {CITY_REGIONS.map(region => (
          <div key={region.name}>
            <div className="wc-region-header">{region.name}</div>
            <div className="wc-region-grid">
              {region.ids.map(id => {
                const city = WORLD_CITIES.find(c => c.id === id);
                if (!city) return null;
                return (
                  <label key={id} className="wc-city-option">
                    <input
                      type="checkbox"
                      data-city-id={city.id}
                      checked={selectedCities.includes(city.id)}
                      onChange={e => toggleCity(city.id, e.target.checked)}
                    />
                    <span className="wc-opt-name">{city.city}</span>
                    <span className="wc-opt-label">{city.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
        <div className="wc-settings-footer">
          <button className="wc-settings-done" onClick={() => setShowSettings(false)}>
            {t('components.worldClock.done') ?? 'Done'}
          </button>
        </div>
      </div>
    );
  }

  if (cityList.length === 0) {
    return (
      <div className="wc-empty">
        No cities selected.{' '}
        <button className="wc-settings-link" onClick={() => setShowSettings(true)}>
          ⚙ Add cities
        </button>
      </div>
    );
  }

  return (
    <div className="wc-outer">
      <div className="wc-toolbar">
        <button
          className="wc-settings-btn"
          title={t('components.worldClock.selectCities') ?? 'Select cities'}
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </div>
      <div
        className={`wc-container${dragId ? ' wc-content-dragging' : ''}`}
        translate="no"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setDragId(null)}
      >
        {cityList.map(city => (
          <div
            key={city.id}
            className="wc-row-wrapper"
            onMouseDown={e => {
              const handle = (e.target as HTMLElement).closest('.wc-drag-handle');
              if (handle) handleDragStart(e, city.id);
            }}
          >
            <CityRow city={city} isHome={city.id === homeCityId} tick={tick} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorldClockPanel() {
  return (
    <PanelShell
      id="world-clock"
      title="World Clock"
      infoTooltip={t('components.worldClock.infoTooltip')}
    >
      <WorldClockPanelContent />
    </PanelShell>
  );
}
