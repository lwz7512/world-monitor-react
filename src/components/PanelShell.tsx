import { useCallback, useEffect, useRef, useState } from 'react';
import { usePanelResize } from '@/hooks/usePanelResize';
import type { DataBadgeState } from '@/hooks/usePanelState';
import type { PanelSeverity } from '@/components/Panel';
import { dataFreshness } from '@/services/data-freshness';
import type { PanelFreshnessDisplay } from '@/services/panel-freshness-display';
import { formatPanelFreshnessDisplay } from '@/services/panel-freshness-display';
import { t } from '@/services/i18n';
import { isDesktopRuntime } from '@/services/runtime';
import { getSecretState } from '@/services/runtime-config';
import { invokeTauri } from '@/services/tauri-bridge';
import { loadPanelCollapsed, savePanelCollapsed } from '@/utils/panel-storage';
import { lockSvg, upgradeSvg } from '@/components/gate-icons';

const FRESHNESS_REFRESH_MS = 60_000;

export interface PanelShellProps {
  id: string;
  title: string;
  children?: React.ReactNode;
  className?: string;
  defaultRowSpan?: number;
  defaultColSpan?: number;
  showCount?: boolean;
  count?: number | null;
  infoTooltip?: string;
  closable?: boolean;
  collapsible?: boolean;
  premium?: boolean;
  trackActivity?: boolean;
  loading?: boolean;
  loadingMessage?: string;
  error?: string | null;
  onRetry?: () => void;
  autoRetrySeconds?: number;
  locked?: boolean;
  lockedFeatures?: string[];
  onLockedCtaClick?: () => void;
  dataBadge?: DataBadgeState;
  severity?: PanelSeverity;
  newItemCount?: number;
  headerActions?: React.ReactNode;
}

function computeFreshnessState(panelId: string): { display: PanelFreshnessDisplay; status: string } | null {
  const summary = dataFreshness.getPanelFreshness(panelId);
  if (!summary) return null;
  return { display: formatPanelFreshnessDisplay(summary), status: summary.status };
}

function RetryCountdown({ seconds, onRetry }: { seconds: number; onRetry: () => void }) {
  const [remaining, setRemaining] = useState(seconds);
  const onRetryRef = useRef(onRetry);
  onRetryRef.current = onRetry;

  useEffect(() => {
    if (remaining <= 0) {
      onRetryRef.current();
      return;
    }
    const timer = setTimeout(() => setRemaining(r => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  return (
    <div className="panel-error-countdown">
      {t('common.retrying')} ({remaining}s)
    </div>
  );
}

function defaultLockedCtaAction() {
  if (isDesktopRuntime()) {
    void invokeTauri<void>('open_url', { url: 'https://worldmonitor.app/pro' }).catch(() => {
      window.open('https://worldmonitor.app/pro', '_blank', 'noopener,noreferrer');
    });
  } else {
    import('@/services/checkout').then(m =>
      import('@/config/products').then(p => m.startCheckout(p.DEFAULT_UPGRADE_PRODUCT)),
    ).catch(() => {
      window.open('https://worldmonitor.app/pro', '_blank', 'noopener,noreferrer');
    });
  }
}

export function PanelShell({
  id,
  title,
  children,
  className,
  defaultRowSpan = 1,
  defaultColSpan = 1,
  showCount = false,
  count = null,
  infoTooltip,
  closable = true,
  collapsible = false,
  premium = false,
  trackActivity = true,
  loading = false,
  loadingMessage,
  error = null,
  onRetry,
  autoRetrySeconds,
  locked = false,
  lockedFeatures = [],
  onLockedCtaClick,
  dataBadge = null,
  severity = 'none',
  newItemCount = 0,
  headerActions,
}: PanelShellProps) {
  const { rowSpan, colSpan, isResizing, rowHandleProps, colHandleProps } = usePanelResize(
    id,
    defaultRowSpan,
    defaultColSpan,
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(() => loadPanelCollapsed()[id] ?? false);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const [freshness, setFreshness] = useState<{ display: PanelFreshnessDisplay; status: string } | null>(
    () => computeFreshnessState(id),
  );

  useEffect(() => {
    function refresh() {
      const next = computeFreshnessState(id);
      if (next) setFreshness(next);
    }
    const unsub = dataFreshness.subscribe(refresh);
    const timer = setInterval(refresh, FRESHNESS_REFRESH_MS);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!tooltipVisible) return;
    function handleDocClick() { setTooltipVisible(false); }
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, [tooltipVisible]);

  const handleCollapse = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      savePanelCollapsed(id, next);
      return next;
    });
  }, [id]);

  const handleClose = useCallback(() => {
    panelRef.current?.dispatchEvent(
      new CustomEvent('wm:panel-close', { bubbles: true, detail: { panelId: id } }),
    );
  }, [id]);

  const handleTooltipClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipVisible(v => !v);
  }, []);

  const handleLockedCta = useCallback(() => {
    if (onLockedCtaClick) {
      onLockedCtaClick();
    } else {
      defaultLockedCtaAction();
    }
  }, [onLockedCtaClick]);

  const spanClass = rowSpan > 1 ? `span-${rowSpan}` : '';
  const colSpanClass = colSpan > 1 ? `col-span-${colSpan}` : '';
  const outerClass = [
    'panel',
    className,
    spanClass,
    colSpanClass,
    locked ? 'panel-is-locked' : '',
    isResizing ? 'panel-resizing' : '',
  ].filter(Boolean).join(' ');

  const showProBadge = premium && !getSecretState('WORLDMONITOR_API_KEY').present;

  let bodyContent: React.ReactNode;
  if (loading) {
    bodyContent = (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        {loadingMessage && <div className="panel-loading-text">{loadingMessage}</div>}
      </div>
    );
  } else if (error) {
    bodyContent = (
      <div className="panel-error-state">
        <div className="panel-loading-radar panel-error-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot error" />
        </div>
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
        {onRetry && (
          <button className="panel-error-retry" type="button" onClick={onRetry}>
            {t('components.panel.retry', { defaultValue: 'Retry' })}
          </button>
        )}
        {onRetry && autoRetrySeconds != null && (
          <RetryCountdown key={error} seconds={autoRetrySeconds} onRetry={onRetry} />
        )}
      </div>
    );
  } else if (locked) {
    bodyContent = (
      <div className="panel-locked-state">
        {/* eslint-disable-next-line react/no-danger */}
        <div className="panel-locked-icon" dangerouslySetInnerHTML={{ __html: lockSvg }} />
        <div className="panel-locked-desc">{t('premium.lockedDesc')}</div>
        {lockedFeatures.length > 0 && (
          <ul className="panel-locked-features">
            {lockedFeatures.map(f => <li key={f}>{f}</li>)}
          </ul>
        )}
        <button type="button" className="panel-locked-cta" onClick={handleLockedCta}>
          {/* eslint-disable-next-line react/no-danger */}
          <span dangerouslySetInnerHTML={{ __html: upgradeSvg }} />
          {t('premium.upgradeToPro')}
        </button>
      </div>
    );
  } else {
    bodyContent = children;
  }

  let dataBadgeLabel = '';
  if (dataBadge === 'live') dataBadgeLabel = t('components.panel.live', { defaultValue: 'Live' });
  else if (dataBadge === 'cached') dataBadgeLabel = t('components.panel.cached', { defaultValue: 'Cached' });
  else if (dataBadge === 'unavailable') dataBadgeLabel = t('components.panel.unavailable', { defaultValue: 'Unavailable' });

  return (
    <div ref={panelRef} className={outerClass} data-panel={id}>
      <div className="panel-header">
        <div className="panel-header-left">
          <span className="panel-title">{title}</span>
          {severity !== 'none' && (
            <span className={`panel-severity-dot severity-${severity}`} aria-hidden="true" />
          )}
          {freshness && (
            <span
              className={`panel-freshness-badge panel-freshness-${freshness.status}`}
              title={freshness.display.title}
            >
              {freshness.display.label}
            </span>
          )}
          {infoTooltip && (
            <div className="panel-info-wrapper">
              <button
                type="button"
                className="panel-info-btn"
                aria-label={t('components.panel.showMethodologyInfo')}
                onClick={handleTooltipClick}
              >
                ?
              </button>
              <div
                className={`panel-info-tooltip${tooltipVisible ? ' visible' : ''}`}
                dangerouslySetInnerHTML={{ __html: infoTooltip }}
              />
            </div>
          )}
          {trackActivity && newItemCount > 0 && (
            <span className="panel-new-badge">{newItemCount}</span>
          )}
          {showProBadge && (
            <span className="panel-pro-badge">{t('premium.pro')}</span>
          )}
        </div>

        {dataBadge && (
          <span className={`panel-data-badge ${dataBadge}`}>{dataBadgeLabel}</span>
        )}

        {showCount && (
          <span className="panel-count">{count ?? 0}</span>
        )}

        {headerActions}

        {collapsible && (
          <button
            type="button"
            className="panel-collapse-btn icon-btn"
            aria-label={collapsed
              ? t('components.panel.expand', { defaultValue: 'Expand' })
              : t('components.panel.collapse', { defaultValue: 'Collapse' })}
            onClick={handleCollapse}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}

        {closable && (
          <button
            type="button"
            className="panel-close-btn icon-btn"
            aria-label={t('components.panel.close', { defaultValue: 'Close' })}
            onClick={handleClose}
          >
            ✕
          </button>
        )}
      </div>

      <div
        className="panel-content"
        id={`${id}Content`}
        style={collapsed ? { display: 'none' } : undefined}
      >
        {bodyContent}
      </div>

      <div
        className="panel-resize-handle"
        title={t('components.panel.dragToResize')}
        {...rowHandleProps}
      />
      <div
        className="panel-col-resize-handle"
        title={t('components.panel.dragToResize')}
        {...colHandleProps}
      />
    </div>
  );
}
