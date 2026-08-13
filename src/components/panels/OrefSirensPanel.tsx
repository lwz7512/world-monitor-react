import { useState, useEffect, useRef } from 'react';
import { t } from '@/services/i18n';
import { hasPremiumAccess } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { isDesktopRuntime } from '@/services/runtime';
import { PanelShell } from '@/components/PanelShell';
import {
  fetchOrefAlerts,
  fetchOrefHistory,
  onOrefAlertsUpdate,
  type OrefAlertsResponse,
  type OrefAlert,
  type OrefHistoryEntry,
} from '@/services/oref-alerts';

const MAX_HISTORY_WAVES = 50;
const ONE_HOUR_MS = 60 * 60 * 1000;
const HISTORY_TTL = 3 * 60 * 1000;

function formatAlertTime(dateStr: string): string {
  try {
    const ts = new Date(dateStr).getTime();
    if (!Number.isFinite(ts)) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return t('components.orefSirens.justNow') ?? 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  } catch {
    return '';
  }
}

function formatWaveTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      + ' ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function AlertRow({ alert }: { alert: OrefAlert }) {
  const areas = (alert.data || []).join(', ');
  const time = formatAlertTime(alert.alertDate);
  return (
    <div className="oref-alert-row">
      <div className="oref-alert-header">
        <span className="oref-alert-title">{alert.title || alert.cat}</span>
        <span className="oref-alert-time">{time}</span>
      </div>
      <div className="oref-alert-areas">{areas}</div>
    </div>
  );
}

function HistoryWaves({ waves, historyCount24h }: { waves: OrefHistoryEntry[]; historyCount24h: number }) {
  if (!waves.length) {
    if (historyCount24h > 0) {
      return (
        <div className="oref-history-section">
          <div className="oref-history-title">
            {t('components.orefSirens.historySummary', { count: String(historyCount24h), waves: '...' })}
          </div>
          <div className="oref-wave-list" style={{ opacity: 0.5, textAlign: 'center', padding: 8 }}>
            {t('components.orefSirens.loadingHistory', { defaultValue: 'Loading history...' }) ?? 'Loading history...'}
          </div>
        </div>
      );
    }
    return null;
  }

  const now = Date.now();
  const sorted = waves
    .map(w => ({ wave: w, ts: new Date(w.timestamp).getTime() }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_HISTORY_WAVES);

  return (
    <div className="oref-history-section">
      <div className="oref-history-title">
        {t('components.orefSirens.historySummary', { count: String(historyCount24h), waves: String(sorted.length) })}
      </div>
      <div className="oref-wave-list">
        {sorted.map(({ wave, ts }) => {
          const isRecent = now - ts < ONE_HOUR_MS;
          const types = wave.alerts.map(a => a.title || a.cat);
          const uniqueTypes = [...new Set(types)];
          const totalAreas = wave.alerts.reduce((sum, a) => sum + (a.data?.length || 0), 0);
          const summary = uniqueTypes.join(', ') + (totalAreas > 0 ? ` - ${totalAreas} areas` : '');
          return (
            <div key={wave.timestamp} className={`oref-wave-row${isRecent ? ' oref-wave-recent' : ''}`}>
              <div className="oref-wave-header">
                <span className="oref-wave-time">{formatWaveTime(wave.timestamp)}</span>
                {isRecent && <span className="oref-recent-badge">RECENT</span>}
              </div>
              <div className="oref-wave-summary">{summary}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OrefSirensPanelContent() {
  const [alertsData, setAlertsData] = useState<OrefAlertsResponse | null>(null);
  const [historyWaves, setHistoryWaves] = useState<OrefHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const historyFetchedAt = useRef(0);

  const loadHistory = () => {
    if (Date.now() - historyFetchedAt.current < HISTORY_TTL) return;
    historyFetchedAt.current = Date.now();
    fetchOrefHistory()
      .then(resp => {
        if (resp.history?.length) setHistoryWaves(resp.history);
      })
      .catch(err => { console.warn('[OrefSirens] History fetch failed:', err); });
  };

  useEffect(() => {
    let cancelled = false;
    fetchOrefAlerts()
      .then(data => {
        if (cancelled) return;
        setAlertsData(data);
        setLoading(false);
        loadHistory();
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('common.failedToLoad') ?? 'Failed');
        setLoading(false);
      });

    onOrefAlertsUpdate((data) => {
      if (cancelled) return;
      setAlertsData(data);
      loadHistory();
    });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">{t('components.orefSirens.checking') ?? 'Checking…'}</div>
      </div>
    );
  }

  if (error || !alertsData) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
      </div>
    );
  }

  if (!alertsData.configured) {
    return (
      <div className="panel-empty">{t('components.orefSirens.notConfigured')}</div>
    );
  }

  const alerts = alertsData.alerts || [];

  return (
    <div className="oref-panel-content">
      {alerts.length === 0 ? (
        <div className="oref-status oref-ok">
          <span className="oref-status-icon">✅</span>
          <span>{t('components.orefSirens.noAlerts')}</span>
        </div>
      ) : (
        <>
          <div className="oref-status oref-danger">
            <span className="oref-pulse" />
            <span>{t('components.orefSirens.activeSirens', { count: String(alerts.length) })}</span>
          </div>
          <div className="oref-list">
            {alerts.slice(0, 20).map((alert, i) => (
              <AlertRow key={alert.alertDate || i} alert={alert} />
            ))}
          </div>
        </>
      )}
      <HistoryWaves waves={historyWaves} historyCount24h={alertsData.historyCount24h || 0} />
    </div>
  );
}

function useDesktopGate() {
  const [authState, setAuthState] = useState(getAuthState);
  useEffect(() => subscribeAuthState(setAuthState), []);
  return isDesktopRuntime() && !hasPremiumAccess(authState);
}

export function OrefSirensPanel() {
  const locked = useDesktopGate();
  return (
    <PanelShell
      id="oref-sirens"
      title={t('panels.orefSirens')}
      showCount
      infoTooltip={t('components.orefSirens.infoTooltip')}
      locked={locked}
      lockedFeatures={locked ? [t('premium.features.orefSirens1'), t('premium.features.orefSirens2')] : undefined}
    >
      <OrefSirensPanelContent />
    </PanelShell>
  );
}
