import { t } from '@/services/i18n';
import { hasPremiumAccess } from '@/services/panel-gating';
import { subscribeAuthState, getAuthState } from '@/services/auth-state';
import { onEntitlementChange } from '@/services/entitlements';
import { showToast } from '@/utils';
import type { CustomWidgetSpec } from '@/services/widget-store';
import type { McpPanelSpec } from '@/services/mcp-store';

/**
 * Appends the three "add panel" action blocks to the panels grid and wires up
 * reactive pro-gating subscriptions. Returns a combined unsubscribe function.
 *
 * The dual auth+entitlement subscription is intentional — Convex entitlement
 * updates don't re-fire subscribeAuthState, so subscribing to both guarantees
 * the CTAs flip visible once the snapshot lands for paying users.
 */
export function createAddPanelBlocks(
  grid: HTMLElement,
  openSettings: () => void,
  addCustomWidget: (spec: CustomWidgetSpec) => Promise<void>,
  addMcpPanel: (spec: McpPanelSpec) => void,
): () => void {
  const addPanelBlock = document.createElement('button');
  addPanelBlock.className = 'add-panel-block';
  addPanelBlock.dataset.clsMover = 'add-panel';
  addPanelBlock.setAttribute('aria-label', t('components.panel.addPanel'));
  const addIcon = document.createElement('span');
  addIcon.className = 'add-panel-block-icon';
  addIcon.textContent = '+';
  const addLabel = document.createElement('span');
  addLabel.className = 'add-panel-block-label';
  addLabel.textContent = t('components.panel.addPanel');
  addPanelBlock.appendChild(addIcon);
  addPanelBlock.appendChild(addLabel);
  addPanelBlock.addEventListener('click', () => {
    openSettings();
  });
  grid.appendChild(addPanelBlock);

  const proBlock = document.createElement('button');
  proBlock.className = 'add-panel-block ai-widget-block ai-widget-block-pro';
  proBlock.dataset.clsMover = 'pro-widget-cta';
  proBlock.setAttribute('aria-label', t('widgets.createInteractive'));
  const proIcon = document.createElement('span');
  proIcon.className = 'add-panel-block-icon';
  proIcon.textContent = '⚡';
  const proLabel = document.createElement('span');
  proLabel.className = 'add-panel-block-label';
  proLabel.textContent = t('widgets.createInteractive');
  const proBadge = document.createElement('span');
  proBadge.className = 'widget-pro-badge';
  proBadge.textContent = t('widgets.proBadge');
  proBlock.appendChild(proIcon);
  proBlock.appendChild(proLabel);
  proBlock.appendChild(proBadge);
  proBlock.addEventListener('click', () => {
    void import('@/components/WidgetChatModal')
      .then((m) =>
        m.openWidgetChatModal({
          mode: 'create',
          tier: 'pro',
          onComplete: (spec) => {
            void addCustomWidget(spec).catch((error) => {
              console.error('[widget-builder] failed to add widget', error);
              showToast(t('widgets.saveFailed'));
            });
          },
        }),
      )
      .catch((err) => console.error('[widget-chat] failed to lazy-load WidgetChatModal', err));
  });
  grid.appendChild(proBlock);

  const mcpBlock = document.createElement('button');
  mcpBlock.className = 'add-panel-block mcp-panel-block';
  mcpBlock.dataset.clsMover = 'mcp-cta';
  mcpBlock.setAttribute('aria-label', t('mcp.connectPanel'));
  const mcpIcon = document.createElement('span');
  mcpIcon.className = 'add-panel-block-icon';
  mcpIcon.textContent = '⚡';
  const mcpLabel = document.createElement('span');
  mcpLabel.className = 'add-panel-block-label';
  mcpLabel.textContent = t('mcp.connectPanel');
  const mcpBadge = document.createElement('span');
  mcpBadge.className = 'widget-pro-badge';
  mcpBadge.textContent = t('widgets.proBadge');
  mcpBlock.appendChild(mcpIcon);
  mcpBlock.appendChild(mcpLabel);
  mcpBlock.appendChild(mcpBadge);
  mcpBlock.addEventListener('click', () => {
    void import('@/components/McpConnectModal')
      .then((m) =>
        m.openMcpConnectModal({
          onComplete: (spec) => addMcpPanel(spec),
        }),
      )
      .catch((err) => console.error('[mcp-connect] failed to lazy-load McpConnectModal', err));
  });
  grid.appendChild(mcpBlock);

  const proBlocks = [proBlock, mcpBlock];
  const applyProBlockGating = (isPro: boolean) => {
    for (const block of proBlocks) {
      block.style.display = isPro ? '' : 'none';
    }
  };
  const reapply = () => applyProBlockGating(hasPremiumAccess(getAuthState()));
  reapply();
  const unsubAuth = subscribeAuthState(reapply);
  const unsubEntitlement = onEntitlementChange(reapply);

  return () => {
    unsubAuth();
    unsubEntitlement();
  };
}
