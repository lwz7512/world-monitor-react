import { useEffect } from 'react';
import { SITE_VARIANT } from '@/config';
import { TvModeController } from '@/services/tv-mode';
import { useAppContextMaybe } from '@/context/AppContext';

export function useTvMode(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx || SITE_VARIANT !== 'happy') return;

    const tvBtn = document.getElementById('tvModeBtn');
    const tvExitBtn = document.getElementById('tvExitBtn');

    const toggleTvMode = () => {
      const panelKeys = Object.keys(ctx.panelSettings).filter(
        key => ctx.panelSettings[key]?.enabled !== false,
      );
      if (!ctx.tvMode) {
        ctx.tvMode = new TvModeController({
          panelKeys,
          onPanelChange: () => {
            document.getElementById('tvModeBtn')?.classList.toggle('active', ctx.tvMode?.active ?? false);
          },
        });
      } else {
        ctx.tvMode.updatePanelKeys(panelKeys);
      }
      ctx.tvMode.toggle();
      document.getElementById('tvModeBtn')?.classList.toggle('active', ctx.tvMode.active);
    };

    tvBtn?.addEventListener('click', toggleTvMode);
    tvExitBtn?.addEventListener('click', toggleTvMode);

    const onKeydown = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'T' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        if (active?.tagName !== 'INPUT' && active?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          toggleTvMode();
        }
      }
    };
    document.addEventListener('keydown', onKeydown);

    return () => {
      document.removeEventListener('keydown', onKeydown);
      tvBtn?.removeEventListener('click', toggleTvMode);
      tvExitBtn?.removeEventListener('click', toggleTvMode);
      ctx.tvMode?.destroy();
      ctx.tvMode = null;
    };
  }, [ctx]);
}
