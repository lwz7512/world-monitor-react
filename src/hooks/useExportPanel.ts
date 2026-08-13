import { useEffect, useRef } from 'react';
import type { AppContext } from '@/app/app-context';
import { useAppContextMaybe } from '@/context/AppContext';
import { getCachedGpsInterference } from '@/services/gps-interference';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { onEntitlementChange } from '@/services/entitlements';
import {
  evaluateAvailableExportFormats,
  evaluateExportGate,
  exportLockToGateReason,
} from '@/services/gates/export';
import { primeExportGateActivation } from '@/services/gates/export-resolver';
import type { DataExportFormat } from '@/services/gates/export-resolver';
import { resolveGateAction, type PanelGateReason } from '@/services/panel-gating';
import { ExportGateControl } from '@/components/ExportGateControl';
import { trackGateHit } from '@/services/analytics';
import { h } from '@/utils/dom-utils';
import { t } from '@/services/i18n';

export function useExportPanel(): void {
  const ctx = useAppContextMaybe();
  const exportPanelLoadRef = useRef<Promise<NonNullable<AppContext['exportPanel']>> | null>(null);

  useEffect(() => {
    if (!ctx) return;

    const getExportData = () => {
      const allCards = ctx.correlationEngine?.getAllCards() ?? [];
      const disabledCount = ctx.disabledSources.size;
      return {
        meta: {
          exportedAt: new Date().toISOString(),
          note: disabledCount > 0
            ? `Export reflects currently enabled sources only. ${disabledCount} source(s) are disabled and not included.`
            : 'Export reflects all active sources.',
        },
        timestamp: Date.now(),
        news: ctx.allNews,
        newsClusters: ctx.latestClusters.length > 0 ? ctx.latestClusters : undefined,
        newsByCategory: ctx.newsByCategory,
        markets: ctx.latestMarkets,
        predictions: ctx.latestPredictions,
        intelligence: ctx.intelligenceCache,
        cyberThreats: ctx.cyberThreatsCache ?? undefined,
        gpsJamming: getCachedGpsInterference() ?? undefined,
        convergenceCards: allCards.map(({ assessment: _a, ...card }) => card),
        monitors: ctx.monitors.length > 0 ? ctx.monitors : undefined,
      };
    };

    const attachExportPanel = (panel: NonNullable<AppContext['exportPanel']>): void => {
      const el = panel.getElement();
      if (el.parentElement) return;
      const headerRight = ctx.container.querySelector('.header-right');
      if (headerRight) {
        headerRight.insertBefore(el, headerRight.firstChild);
      }
    };

    let currentExportFormats: readonly DataExportFormat[] = [];

    const ensureExportPanel = (): Promise<NonNullable<AppContext['exportPanel']>> => {
      if (ctx.exportPanel) {
        ctx.exportPanel.setAvailableFormats(currentExportFormats);
        attachExportPanel(ctx.exportPanel);
        return Promise.resolve(ctx.exportPanel);
      }
      if (exportPanelLoadRef.current) return exportPanelLoadRef.current;

      exportPanelLoadRef.current = import('@/utils/export')
        .then(({ ExportPanel }) => {
          if (ctx.isDestroyed) {
            throw new Error('useExportPanel: ctx destroyed before export panel loaded');
          }
          const panel = new ExportPanel(getExportData, currentExportFormats);
          ctx.exportPanel = panel;
          attachExportPanel(panel);
          return panel;
        })
        .catch((err) => {
          exportPanelLoadRef.current = null;
          throw err;
        });

      return exportPanelLoadRef.current;
    };

    let lockedControl: ExportGateControl | null = null;
    let lockedReason: PanelGateReason | null = null;
    let isUnlocked = false;

    // Created up front and empty: an aria-live region only announces content
    // injected AFTER it is in the accessibility tree.
    const liveRegion = h('span', { className: 'wm-visually-hidden', role: 'status' });
    liveRegion.setAttribute('aria-live', 'polite');
    ctx.container.querySelector('.header-right')?.appendChild(liveRegion);

    const removeLockedControl = (): void => {
      lockedControl?.destroy();
      lockedControl = null;
      lockedReason = null;
    };

    const showLocked = (reason: PanelGateReason): void => {
      isUnlocked = false;
      const panelEl = ctx.exportPanel?.getElement();
      if (panelEl) panelEl.style.display = 'none';
      lockedReason = reason;
      if (lockedControl) {
        lockedControl.update(reason);
        return;
      }
      lockedControl = new ExportGateControl({
        reason,
        onOpen: () => trackGateHit('export'),
        onAction: () => {
          if (lockedReason === null) return;
          resolveGateAction(lockedReason, { openAuthModal: () => ctx.authModal?.open() })();
        },
      });
      const headerRight = ctx.container.querySelector('.header-right');
      headerRight?.insertBefore(lockedControl.getElement(), headerRight.firstChild);
    };

    const unlock = (formats: readonly DataExportFormat[]): void => {
      currentExportFormats = formats;
      const wasLocked = lockedControl !== null;
      if (!wasLocked && isUnlocked) {
        ctx.exportPanel?.setAvailableFormats(currentExportFormats);
        return;
      }
      isUnlocked = true;
      removeLockedControl();
      void ensureExportPanel()
        .then((panel) => {
          if (ctx.isDestroyed) return;
          if (lockedControl) {
            panel.getElement().style.display = 'none';
            return;
          }
          panel.setAvailableFormats(currentExportFormats);
          panel.getElement().style.display = '';
          if (wasLocked) liveRegion.textContent = t('components.exportGate.unlockedAnnouncement');
        })
        .catch((err) => {
          isUnlocked = false;
          console.warn('[export-panel] Failed to lazy-load ExportPanel:', err);
        });
    };

    const applyGate = (): void => {
      if (ctx.isDestroyed) return;
      const authState = getAuthState();
      const verdict = evaluateExportGate(authState);
      if (verdict.locked) {
        showLocked(exportLockToGateReason(verdict.reason));
        return;
      }
      if (verdict.pendingActivation) {
        void primeExportGateActivation().then((active) => {
          if (active) applyGate();
        });
      }
      unlock(evaluateAvailableExportFormats(authState));
    };

    applyGate();
    const unsubAuth = subscribeAuthState(() => applyGate());
    const unsubEntitlement = onEntitlementChange(() => applyGate());

    return () => {
      unsubAuth();
      unsubEntitlement();
      removeLockedControl();
      liveRegion.remove();
    };
  }, [ctx]);
}
