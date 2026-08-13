import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { detectPlatform, allButtons, buttonsForPlatform } from '@/components/DownloadBanner';
import type { Platform } from '@/components/DownloadBanner';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { trackDownloadClicked } from '@/services/analytics';
import { t } from '@/services/i18n';

export function useDownloadDropdown(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;

    function platformLabel(p: Platform): string {
      switch (p) {
        case 'macos-arm64': return ' Silicon';
        case 'macos-x64': return ' Intel';
        case 'macos': return ' macOS';
        case 'windows': return 'Windows';
        case 'linux': return 'Linux';
        default: return t('header.downloadApp');
      }
    }

    function initDownloadDropdown(): (() => void) | null {
      const btn = document.getElementById('downloadBtn');
      const dropdown = document.getElementById('downloadDropdown');
      const label = document.getElementById('downloadBtnLabel');
      if (!btn || !dropdown) return null;

      const platform = detectPlatform();
      if (label) label.textContent = platformLabel(platform);

      const primary = buttonsForPlatform(platform);
      const all = allButtons();
      const others = all.filter(b => !primary.some(p => p.href === b.href));

      const primaryHtml = primary.map(b =>
        `<a class="dl-dd-btn ${b.cls} primary" href="${b.href}">${b.label}</a>`
      ).join('');
      const othersHtml = others.map(b =>
        `<a class="dl-dd-btn ${b.cls}" href="${b.href}">${b.label}</a>`
      ).join('');

      setTrustedHtml(dropdown, trustedHtml(`
        <div class="dl-dd-tagline">${t('modals.downloadBanner.description')}</div>
        <div class="dl-dd-buttons">${primaryHtml}</div>
        ${others.length ? `<button class="dl-dd-toggle" id="dlDdToggle">${t('modals.downloadBanner.showAllPlatforms')}</button>
        <div class="dl-dd-others" id="dlDdOthers">${othersHtml}</div>` : ''}
      `, "legacy direct innerHTML migration"));

      dropdown.querySelectorAll<HTMLAnchorElement>('.dl-dd-btn').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const plat = new URL(a.href, location.origin).searchParams.get('platform') || 'unknown';
          trackDownloadClicked(plat);
          window.open(a.href, '_blank', 'noopener,noreferrer');
          dropdown.classList.remove('open');
        });
      });

      const toggle = dropdown.querySelector('#dlDdToggle');
      const othersEl = dropdown.querySelector('#dlDdOthers') as HTMLElement | null;
      if (toggle && othersEl) {
        toggle.addEventListener('click', () => {
          const showing = othersEl.classList.toggle('show');
          toggle.textContent = showing
            ? t('modals.downloadBanner.showLess')
            : t('modals.downloadBanner.showAllPlatforms');
        });
      }

      function onBtnClick(e: MouseEvent): void {
        e.stopPropagation();
        dropdown!.classList.toggle('open');
      }
      function onDocClick(e: MouseEvent): void {
        if (!dropdown!.contains(e.target as Node) && !btn!.contains(e.target as Node)) {
          dropdown!.classList.remove('open');
        }
      }
      function onDocKeydown(e: KeyboardEvent): void {
        if (e.key === 'Escape') dropdown!.classList.remove('open');
      }

      btn.addEventListener('click', onBtnClick);
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onDocKeydown);

      return () => {
        btn.removeEventListener('click', onBtnClick);
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onDocKeydown);
      };
    }

    function initFooterDownload(): void {
      const mount = document.getElementById('footerDownloadMount');
      if (!mount) return;
      const platform = detectPlatform();
      const primary = buttonsForPlatform(platform);
      const btn = primary[0];
      if (!btn) return;
      const a = document.createElement('a');
      a.href = btn.href;
      a.textContent = t('header.downloadApp');
      a.className = 'site-footer-download-link';
      a.target = '_blank';
      a.rel = 'noopener';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const plat = new URL(btn.href, location.origin).searchParams.get('platform') || 'unknown';
        trackDownloadClicked(plat);
        window.open(btn.href, '_blank', 'noopener,noreferrer');
      });
      mount.replaceWith(a);
    }

    const dropdownCleanup = initDownloadDropdown();
    initFooterDownload();

    return () => {
      dropdownCleanup?.();
    };
  }, [ctx]);
}
