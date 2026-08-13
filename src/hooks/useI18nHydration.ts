import { useEffect } from 'react';
import { I18N_RESOURCES_LOADED_EVENT, type I18nResourcesLoadedDetail, t } from '@/services/i18n';
import { replaceRawI18nKeyPlaceholders } from '@/app/i18n-raw-key-healer';

export function useI18nHydration(): void {
  useEffect(() => {
    const container = document.getElementById('app');
    if (!container) return;
    const handler = (ev: Event): void => {
      const language = (ev as CustomEvent<I18nResourcesLoadedDetail>).detail?.language;
      if (language !== 'en') return;
      replaceRawI18nKeyPlaceholders(container, t);
    };
    window.addEventListener(I18N_RESOURCES_LOADED_EVENT, handler);
    return () => { window.removeEventListener(I18N_RESOURCES_LOADED_EVENT, handler); };
  }, []);
}
