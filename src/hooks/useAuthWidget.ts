import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { AuthLauncher } from '@/components/AuthLauncher';
import { AuthHeaderWidget } from '@/components/AuthHeaderWidget';

export function useAuthWidget(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    const modal = new AuthLauncher();
    ctx.authModal = modal;

    const widget = new AuthHeaderWidget(
      () => modal.open(),
      () => ctx.unifiedSettings?.open('settings'),
      () => ctx.unifiedSettings?.open('billing'),
    );
    ctx.authHeaderWidget = widget;

    const mount = document.getElementById('authWidgetMount');
    if (mount) {
      mount.appendChild(widget.getElement());
    }

    actions.setupMobileAuth(modal);

    return () => {
      widget.destroy();
      modal.destroy();
      ctx.authModal = null;
      ctx.authHeaderWidget = null;
    };
  }, [ctx]);
}
