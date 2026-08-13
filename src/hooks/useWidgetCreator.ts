import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { showToast } from '@/utils';
import { t } from '@/services/i18n';

/**
 * Listens on ctx.container for the 'wm:open-widget-creator' custom event
 * (dispatched by the ChatAnalystPanel action chip) and opens WidgetChatModal.
 * Previously wired in PanelLayoutManager.init(). Phase 7 Batch 2 extraction.
 */
export function useWidgetCreator(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    const handler = ((e: CustomEvent<{ initialMessage?: string }>) => {
      void import('@/components/WidgetChatModal').then((m) => m.openWidgetChatModal({
        mode: 'create',
        tier: 'pro',
        initialMessage: e.detail.initialMessage,
        onComplete: (spec) => {
          void actions.addCustomWidget(spec).catch((error) => {
            console.error('[widget-builder] failed to add widget', error);
            showToast(t('widgets.saveFailed'));
          });
        },
      })).catch((err) => console.error('[widget-chat] failed to lazy-load WidgetChatModal', err));
    }) as EventListener;

    ctx.container.addEventListener('wm:open-widget-creator', handler);
    return () => {
      ctx.container.removeEventListener('wm:open-widget-creator', handler);
    };
  }, [ctx]);
}
