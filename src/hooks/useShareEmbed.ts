import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { buildMapUrl, getCurrentTheme } from '@/utils';
import { SITE_VARIANT } from '@/config';
import { buildEmbedIframeSnippet, buildEmbedMapUrl, type EmbedVariant } from '@/embed/embed-url';

export function useShareEmbed(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;

    let embedKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

    function getShareUrl(): string | null {
      if (!c.map) return null;
      const state = c.map.getState();
      const center = c.map.getCenter();
      const baseUrl = `${window.location.origin}${window.location.pathname}`;
      const briefPage = c.countryBriefPage;
      const isCountryVisible = briefPage?.isVisible() ?? false;
      return buildMapUrl(baseUrl, {
        view: state.view,
        zoom: state.zoom,
        center,
        timeRange: state.timeRange,
        layers: state.layers,
        country: isCountryVisible ? (briefPage?.getCode() ?? undefined) : undefined,
        expanded: isCountryVisible && briefPage?.getIsMaximized?.() ? true : undefined,
        chokepoint: !isCountryVisible ? (c.activeChokepoint ?? undefined) : undefined,
      });
    }

    function getEmbedUrl(): string | null {
      if (!c.map) return null;
      const state = c.map.getState();
      return buildEmbedMapUrl(`${window.location.origin}/embed`, {
        layers: state.layers,
        center: c.map.getCenter(),
        zoom: state.zoom,
        theme: getCurrentTheme(),
        variant: SITE_VARIANT as EmbedVariant,
      });
    }

    async function copyToClipboard(text: string): Promise<void> {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    function setCopyLinkFeedback(button: HTMLElement | null, message: string): void {
      if (!button) return;
      const originalText = button.textContent ?? '';
      button.textContent = message;
      button.classList.add('copied');
      window.setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copied');
      }, 1500);
    }

    function closeEmbedDialog(): void {
      document.getElementById('embedModalOverlay')?.remove();
      if (embedKeydownHandler) {
        document.removeEventListener('keydown', embedKeydownHandler);
        embedKeydownHandler = null;
      }
    }

    function openEmbedDialog(): void {
      const embedUrl = getEmbedUrl();
      if (!embedUrl) return;
      const snippet = buildEmbedIframeSnippet(embedUrl);
      closeEmbedDialog();

      const overlay = document.createElement('div');
      overlay.className = 'embed-modal-overlay active';
      overlay.id = 'embedModalOverlay';
      overlay.setAttribute('role', 'presentation');

      const dialog = document.createElement('div');
      dialog.className = 'embed-modal';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'embedModalTitle');

      const header = document.createElement('div');
      header.className = 'embed-modal-header';
      const title = document.createElement('h2');
      title.id = 'embedModalTitle';
      title.textContent = 'Embed this map';
      const closeButton = document.createElement('button');
      closeButton.className = 'embed-modal-close';
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Close embed dialog');
      closeButton.textContent = 'x';
      header.append(title, closeButton);

      const preview = document.createElement('iframe');
      preview.className = 'embed-preview-frame';
      preview.title = 'World Monitor live map preview';
      preview.loading = 'lazy';
      preview.referrerPolicy = 'strict-origin-when-cross-origin';
      preview.src = embedUrl;

      const label = document.createElement('label');
      label.className = 'embed-snippet-label';
      label.htmlFor = 'embedSnippetTextarea';
      label.textContent = 'Iframe snippet';

      const textarea = document.createElement('textarea');
      textarea.className = 'embed-snippet-textarea';
      textarea.id = 'embedSnippetTextarea';
      textarea.readOnly = true;
      textarea.value = snippet;

      const actions = document.createElement('div');
      actions.className = 'embed-modal-actions';
      const copyButton = document.createElement('button');
      copyButton.className = 'embed-copy-btn';
      copyButton.type = 'button';
      copyButton.textContent = 'Copy snippet';
      actions.append(copyButton);

      dialog.append(header, preview, label, textarea, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      closeButton.addEventListener('click', () => closeEmbedDialog());
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) closeEmbedDialog();
      });
      copyButton.addEventListener('click', async () => {
        try {
          await copyToClipboard(snippet);
          copyButton.textContent = 'Copied!';
        } catch (error) {
          console.warn('Failed to copy embed snippet:', error);
          copyButton.textContent = 'Copy failed';
        }
      });
      embedKeydownHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') closeEmbedDialog();
      };
      document.addEventListener('keydown', embedKeydownHandler);
      textarea.focus();
      textarea.select();
    }

    async function onCopyLink() {
      const shareUrl = getShareUrl();
      if (!shareUrl) return;
      const button = document.getElementById('copyLinkBtn');
      try {
        await copyToClipboard(shareUrl);
        setCopyLinkFeedback(button, 'Copied!');
      } catch (error) {
        console.warn('Failed to copy share link:', error);
        setCopyLinkFeedback(button, 'Copy failed');
      }
    }

    function onEmbedLink() { openEmbedDialog(); }

    const copyLinkBtn = document.getElementById('copyLinkBtn');
    const embedLinkBtn = document.getElementById('embedLinkBtn');
    copyLinkBtn?.addEventListener('click', onCopyLink);
    embedLinkBtn?.addEventListener('click', onEmbedLink);

    return () => {
      closeEmbedDialog();
      copyLinkBtn?.removeEventListener('click', onCopyLink);
      embedLinkBtn?.removeEventListener('click', onEmbedLink);
    };
  }, [ctx]);
}
