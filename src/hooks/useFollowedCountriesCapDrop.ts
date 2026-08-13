import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import {
  FREE_TIER_FOLLOW_LIMIT,
  WM_FOLLOWED_COUNTRIES_CAP_DROP,
} from '@/services/followed-countries';

export function useFollowedCountriesCapDrop() {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    let timerRef: number | null = null;

    function showToastUI(kept: number, dropped: number): void {
      if (timerRef !== null) {
        window.clearTimeout(timerRef);
        timerRef = null;
      }
      document.querySelector('.wm-followed-cap-drop-toast')?.remove();

      const toast = document.createElement('div');
      toast.className = 'wm-followed-cap-drop-toast update-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');

      const body = document.createElement('div');
      body.className = 'update-toast-body';

      const title = document.createElement('div');
      title.className = 'update-toast-title';
      title.textContent = 'Follow limit reached';

      const detail = document.createElement('div');
      detail.className = 'update-toast-detail';
      const countryWord = dropped === 1 ? 'country was' : 'countries were';
      detail.textContent = `${kept} kept. ${dropped} ${countryWord} not added because the free plan supports ${FREE_TIER_FOLLOW_LIMIT} followed countries.`;

      body.append(title, detail);

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'update-toast-action';
      action.dataset.action = 'upgrade';
      action.textContent = 'Upgrade';

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'update-toast-dismiss';
      dismiss.dataset.action = 'dismiss';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.textContent = '×';

      toast.append(body, action, dismiss);

      timerRef = window.setTimeout(() => {
        toast.remove();
        timerRef = null;
      }, 8000);

      toast.addEventListener('click', (e) => {
        const clickedAction = (e.target as HTMLElement)
          .closest<HTMLElement>('[data-action]')
          ?.dataset.action;
        if (clickedAction === 'upgrade') {
          window.open('/pro#pricing', '_blank', 'noopener,noreferrer');
          if (timerRef !== null) { window.clearTimeout(timerRef); timerRef = null; }
          toast.remove();
        } else if (clickedAction === 'dismiss') {
          if (timerRef !== null) { window.clearTimeout(timerRef); timerRef = null; }
          toast.remove();
        }
      });

      document.body.appendChild(toast);
      window.requestAnimationFrame(() => toast.classList.add('visible'));
    }

    function onCapDrop(ev: Event): void {
      const detail = (ev as CustomEvent<{ kept?: unknown; dropped?: unknown }>).detail;
      const dropped = typeof detail?.dropped === 'number' ? detail.dropped : 0;
      const kept = typeof detail?.kept === 'number' ? detail.kept : FREE_TIER_FOLLOW_LIMIT;
      if (dropped <= 0) return;
      showToastUI(kept, dropped);
    }

    window.addEventListener(WM_FOLLOWED_COUNTRIES_CAP_DROP, onCapDrop);

    return () => {
      window.removeEventListener(WM_FOLLOWED_COUNTRIES_CAP_DROP, onCapDrop);
      if (timerRef !== null) { window.clearTimeout(timerRef); timerRef = null; }
      document.querySelector('.wm-followed-cap-drop-toast')?.remove();
    };
  }, [ctx]);
}
