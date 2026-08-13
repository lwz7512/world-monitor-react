import { useEffect } from 'react';
import { isDesktopRuntime } from '@/services/runtime';
import { invokeTauri } from '@/services/tauri-bridge';

export function useDesktopExternalLinks(): void {
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const anchor = e.target.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.href;
      if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('#')) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin === window.location.origin) return;
      if (!/^https?:$/.test(url.protocol)) return;
      e.preventDefault();
      e.stopPropagation();
      void invokeTauri<void>('open_url', { url: url.toString() }).catch(() => {
        window.open(url.toString(), '_blank', 'noopener,noreferrer');
      });
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, []);
}
