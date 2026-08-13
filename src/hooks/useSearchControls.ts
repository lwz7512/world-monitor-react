import { useEffect } from 'react';
import { track } from '@/services/analytics';
import { overlayHistory } from '@/utils/overlay-history';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { useAppContextMaybe } from '@/context/AppContext';

export function useSearchControls(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    const ac = new AbortController();
    const { signal } = ac;

    const wireButton = (id: string, source: string) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', () => {
        track('search-open', { source });
        actions.openSearch();
      }, { signal });
    };
    wireButton('searchBtn', 'desktop');
    wireButton('mobileSearchBtn', 'mobile');

    // !e.shiftKey so Cmd/Ctrl+Shift+K (e.g. Firefox web console) doesn't toggle search;
    // .toLowerCase() still tolerates CapsLock. (#4403)
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // A keyboard toggle can arrive while the mobile tab is still loading Search.
        // Reuse that pending marker so the eventual modal replaces it instead of
        // pushing a second history entry.
        actions.openSearch({
          toggle: true,
          historyPending: overlayHistory.top() === 'search-pending',
        });
      }
    }, { signal });

    return () => ac.abort();
  }, [ctx]);
}
