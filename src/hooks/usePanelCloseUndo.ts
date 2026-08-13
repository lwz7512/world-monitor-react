import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { deleteWidget } from '@/services/widget-store';
import { deleteMcpPanel } from '@/services/mcp-store';
import type { PanelConfig } from '@/types';
import { saveToStorage } from '@/utils';
import { STORAGE_KEYS } from '@/config';
import { trackPanelToggled } from '@/services/analytics';
import { t } from '@/services/i18n';

export function usePanelCloseUndo(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;
    const closedPanelStack: string[] = [];

    function performUndo() {
      const panelId = closedPanelStack.pop();
      if (!panelId) return;
      getPublishedAppActions()?.enablePanelById?.(panelId);
    }

    function onPanelClose(e: Event) {
      const { panelId } = (e as CustomEvent<{ panelId: string }>).detail;
      const actions = getPublishedAppActions();

      if (panelId.startsWith('cw-')) {
        if (!window.confirm(t('widgets.confirmDelete'))) return;
        deleteWidget(panelId);
        const panel = c.panels[panelId];
        panel?.destroy();
        delete c.panels[panelId];
        delete c.panelSettings[panelId];
        saveToStorage(STORAGE_KEYS.panels, c.panelSettings);
        panel?.getElement()?.remove();
        return;
      }

      if (panelId.startsWith('mcp-')) {
        if (!window.confirm(t('mcp.confirmDelete'))) return;
        deleteMcpPanel(panelId);
        const panel = c.panels[panelId];
        panel?.destroy();
        delete c.panels[panelId];
        delete c.panelSettings[panelId];
        saveToStorage(STORAGE_KEYS.panels, c.panelSettings);
        panel?.getElement()?.remove();
        return;
      }

      const config = c.panelSettings[panelId];
      if (!config) return;
      config.enabled = false;
      // Live-media teardown is handled centrally by applyPanelSettings() below, which
      // calls stopLiveMediaForClose() on every now-disabled panel. Calling it here too
      // double-fired the lifecycle hook for live-news / live-webcams.
      trackPanelToggled(panelId, false);
      saveToStorage(STORAGE_KEYS.panels, c.panelSettings);
      actions?.applyPanelSettings();
      c.unifiedSettings?.refreshPanelToggles();
      closedPanelStack.push(panelId);
      if (closedPanelStack.length > 20) closedPanelStack.shift();
    }

    function onUndo(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const tag = (e.target as HTMLElement)?.tagName ?? '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
        e.preventDefault();
        performUndo();
      }
    }

    function onStorage(e: StorageEvent) {
      const actions = getPublishedAppActions();
      if (e.key === STORAGE_KEYS.panels && e.newValue) {
        try {
          c.panelSettings = JSON.parse(e.newValue) as Record<string, PanelConfig>;
          actions?.applyPanelSettings();
          c.unifiedSettings?.refreshPanelToggles();
        } catch (_) { }
      }
      if (e.key === STORAGE_KEYS.liveChannels && e.newValue) {
        window.dispatchEvent(new CustomEvent('wm:live-news-refresh-channels'));
      }
    }

    c.container.addEventListener('wm:panel-close', onPanelClose);
    document.addEventListener('keydown', onUndo);
    window.addEventListener('storage', onStorage);

    return () => {
      c.container.removeEventListener('wm:panel-close', onPanelClose);
      document.removeEventListener('keydown', onUndo);
      window.removeEventListener('storage', onStorage);
    };
  }, [ctx]);
}
