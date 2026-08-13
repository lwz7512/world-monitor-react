import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { getEffectivePanelConfig, isPanelEntitled, SITE_VARIANT } from '@/config';
import { hasPremiumAccess } from '@/services/panel-gating';
import { getAuthState } from '@/services/auth-state';

/**
 * Wires the ChatAnalystPanel's dashboard action handler to the app's
 * agent-bus-applier. Previously set up inside PanelLayoutManager.createPanels().
 * Phase 7 Batch 2 extraction.
 */
export function useChatAnalystBridge(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    void import('@/components/panels/ChatAnalystPanel')
      .then(({ setDashboardActionHandler }) =>
        import('@/app/agent-bus-applier')
          .then(({ applyAgentBusAction }) => {
            setDashboardActionHandler((action) => applyAgentBusAction(ctx, action, {
              getPanelConfig: (panelId) => getEffectivePanelConfig(panelId, SITE_VARIANT),
              isPanelAllowed: (panelId, config) => isPanelEntitled(panelId, config, hasPremiumAccess(getAuthState())),
              hasPremiumAccess: () => hasPremiumAccess(getAuthState()),
              applyLayerChange: actions.applyMapLayerChange,
            }));
          })
          .catch((err) => {
            console.error('[panel] failed to lazy-load "chat-analyst" dashboard action handler', err);
          }),
      );
  }, [ctx]);
}
