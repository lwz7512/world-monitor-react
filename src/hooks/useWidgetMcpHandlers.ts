import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getWidget, saveWidget } from '@/services/widget-store';
import { getMcpPanel, saveMcpPanel } from '@/services/mcp-store';
import type { CustomWidgetPanel } from '@/components/CustomWidgetPanel';
import type { McpDataPanel } from '@/components/McpDataPanel';
import { showToast } from '@/utils';
import { t } from '@/services/i18n';

export function useWidgetMcpHandlers(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;

    function onWidgetModify(e: Event) {
      const { widgetId } = (e as CustomEvent<{ widgetId: string }>).detail;
      const spec = getWidget(widgetId);
      if (!spec) return;
      void import('@/components/WidgetChatModal').then((m) => m.openWidgetChatModal({
        mode: 'modify',
        existingSpec: spec,
        onComplete: (updated) => {
          void saveWidget(updated).then(() => {
            (c.panels[updated.id] as CustomWidgetPanel | undefined)?.updateSpec(updated);
          }).catch((error) => {
            console.error('[widget-chat] failed to save widget', error);
            showToast(t('widgets.saveFailed'));
          });
        },
      })).catch((err) => console.error('[widget-chat] failed to lazy-load WidgetChatModal', err));
    }

    function onMcpConfigure(e: Event) {
      const { panelId } = (e as CustomEvent<{ panelId: string }>).detail;
      const spec = getMcpPanel(panelId);
      if (!spec) return;
      void import('@/components/McpConnectModal').then((m) => m.openMcpConnectModal({
        existingSpec: spec,
        onComplete: (updated) => {
          saveMcpPanel(updated);
          (c.panels[updated.id] as McpDataPanel | undefined)?.updateSpec(updated);
        },
      })).catch((err) => console.error('[mcp-connect] failed to lazy-load McpConnectModal', err));
    }

    c.container.addEventListener('wm:widget-modify', onWidgetModify);
    c.container.addEventListener('wm:mcp-configure', onMcpConfigure);

    return () => {
      c.container.removeEventListener('wm:widget-modify', onWidgetModify);
      c.container.removeEventListener('wm:mcp-configure', onMcpConfigure);
    };
  }, [ctx]);
}
