import { isDesktopRuntime } from '@/services/runtime';
import { SITE_VARIANT } from '@/config';
import { BETA_MODE } from '@/config/beta';
import { t } from '@/services/i18n';
import { getCurrentTheme } from '@/utils';
import { loadFromStorage } from '@/utils';
import { getStoredMapModePreference } from '@/services/map-mode-preference';

declare const __APP_VERSION__: string;

const REFERENCE_LINKS = [
  { label: 'Countries', path: '/countries/' },
  { label: 'Chokepoints', path: '/chokepoints/' },
  { label: 'Crises', path: '/crises/' },
  { label: 'Tools', path: '/tools/' },
] as const;

const VARIANTS = [
  { key: 'full', icon: '🌍', labelKey: 'header.world' as const, prod: 'https://worldmonitor.app/dashboard' },
  { key: 'tech', icon: '💻', labelKey: 'header.tech' as const, prod: 'https://tech.worldmonitor.app' },
  { key: 'finance', icon: '📈', labelKey: 'header.finance' as const, prod: 'https://finance.worldmonitor.app' },
  { key: 'commodity', icon: '⛏️', labelKey: 'header.commodity' as const, prod: 'https://commodity.worldmonitor.app' },
  { key: 'energy', icon: '⚡', labelKey: 'header.energy' as const, prod: 'https://energy.worldmonitor.app' },
  { key: 'happy', icon: '☀️', label: 'Good News', prod: 'https://happy.worldmonitor.app' },
] as const;

const REGION_OPTIONS = [
  { value: 'global', labelKey: 'components.deckgl.views.global' as const },
  { value: 'america', labelKey: 'components.deckgl.views.americas' as const },
  { value: 'mena', labelKey: 'components.deckgl.views.mena' as const },
  { value: 'eu', labelKey: 'components.deckgl.views.europe' as const },
  { value: 'asia', labelKey: 'components.deckgl.views.asia' as const },
  { value: 'latam', labelKey: 'components.deckgl.views.latam' as const },
  { value: 'africa', labelKey: 'components.deckgl.views.africa' as const },
  { value: 'oceania', labelKey: 'components.deckgl.views.oceania' as const },
] as const;

export function AppShell() {
  const isDesktop = isDesktopRuntime();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const isGlobeMode = getStoredMapModePreference() === 'globe';
  const mapStartsCollapsed = isMobile && loadFromStorage<boolean>('mobile-map-collapsed', true) === true;
  const isDark = getCurrentTheme() === 'dark';
  const local =
    isDesktop ||
    (typeof location !== 'undefined' &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1'));
  const inIframe = typeof window !== 'undefined' && window.self !== window.top;

  const vHref = (v: string, prod: string) => (local || SITE_VARIANT === v ? '#' : prod);
  const vAttrs = (v: string) =>
    !local && SITE_VARIANT !== v && inIframe
      ? ({ target: '_blank', rel: 'noopener' } as const)
      : ({} as Record<string, never>);

  const refLink = (path: string, label: string) => {
    const href = isDesktop ? `https://www.worldmonitor.app${path}` : path;
    return (
      <a key={path} href={href} target="_blank" rel="noopener">
        {label}
      </a>
    );
  };

  const mapTitle =
    SITE_VARIANT === 'tech'
      ? t('panels.techMap')
      : SITE_VARIANT === 'happy'
        ? 'Good News Map'
        : t('panels.map');

  return (
    <>
      {isDesktop && <div className="tauri-titlebar" data-tauri-drag-region />}
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <div id="proBannerSlot" className="pro-banner-slot" aria-live="polite" />

      {/* Header */}
      <div className="header">
        <div className="header-left">
          <div className="variant-switcher">
            {VARIANTS.flatMap((v, i, arr) => {
              const label = 'labelKey' in v ? t(v.labelKey) : v.label;
              const el = (
                <a
                  key={v.key}
                  href={vHref(v.key, v.prod)}
                  className={`variant-option${SITE_VARIANT === v.key ? ' active' : ''}`}
                  data-variant={v.key}
                  {...vAttrs(v.key)}
                  title={`${label}${SITE_VARIANT === v.key ? ` ${t('common.currentVariant')}` : ''}`}
                >
                  <span className="variant-icon">{v.icon}</span>
                  <span className="variant-label">{label}</span>
                </a>
              );
              return i < arr.length - 1
                ? [el, <span key={`d${i}`} className="variant-divider" />]
                : [el];
            })}
          </div>
          <span className="logo">MONITOR</span>
          <span className="logo-mobile">World Monitor</span>
          <span className="version">v{__APP_VERSION__}</span>
          {BETA_MODE && <span className="beta-badge">BETA</span>}
          <a
            href="https://x.com/eliehabib"
            target="_blank"
            rel="noopener"
            className="credit-link"
          >
            <svg className="x-logo" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <span className="credit-text">@eliehabib</span>
          </a>
          <a
            href="https://github.com/koala73/worldmonitor"
            target="_blank"
            rel="noopener"
            className="github-link"
            title={t('header.viewOnGitHub')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <button className="mobile-settings-btn" id="mobileSettingsBtn" title={t('header.settings')}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <div className="status-indicator">
            <span className="status-dot" />
            <span>{t('header.live')}</span>
          </div>
          <div className="region-selector">
            <select id="regionSelect" className="region-select" aria-label={t('header.selectRegion')}>
              {REGION_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {t(r.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <span id="missionPresetMount" className="mission-preset-mount" />
          <button className="mobile-search-btn" id="mobileSearchBtn" aria-label={t('header.search')}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </div>
        <div className="header-right">
          <button className="search-btn" id="searchBtn">
            <kbd>⌘K</kbd> {t('header.search')}
          </button>
          {!isDesktop && (
            <button className="copy-link-btn" id="copyLinkBtn">
              {t('header.copyLink')}
            </button>
          )}
          {!isDesktop && (
            <button className="copy-link-btn embed-link-btn" id="embedLinkBtn">
              {t('header.embed')}
            </button>
          )}
          {!isDesktop && (
            <button className="fullscreen-btn" id="fullscreenBtn" title={t('header.fullscreen')}>
              ⛶
            </button>
          )}
          {SITE_VARIANT === 'happy' && (
            <button className="tv-mode-btn" id="tvModeBtn" title="TV Mode (Shift+T)">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </button>
          )}
          <span id="unifiedSettingsMount" />
          <span id="authWidgetMount" className="auth-widget-mount" />
        </div>
      </div>

      {/* Mobile menu overlay */}
      <div className="mobile-menu-overlay" id="mobileMenuOverlay" />
      <nav className="mobile-menu" id="mobileMenu">
        <div className="mobile-menu-header">
          <span className="mobile-menu-title">WORLD MONITOR</span>
          <button className="mobile-menu-close" id="mobileMenuClose" aria-label="Close menu">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="mobile-menu-divider" />
        <div className="mobile-menu-account" aria-label="Account">
          <span className="mobile-menu-account-icon" aria-hidden="true">
            ◯
          </span>
          <div id="mobileAuthWidgetMount" />
          <button className="mobile-auth-fallback" id="mobileAuthFallback" type="button">
            Sign In
          </button>
        </div>
        <div className="mobile-menu-divider" />
        {VARIANTS.map((v) => {
          const label = 'labelKey' in v ? t(v.labelKey) : v.label;
          return (
            <button
              key={v.key}
              className={`mobile-menu-item mobile-menu-variant${SITE_VARIANT === v.key ? ' active' : ''}`}
              data-variant={v.key}
            >
              <span className="mobile-menu-item-icon">{v.icon}</span>
              <span className="mobile-menu-item-label">{label}</span>
              {SITE_VARIANT === v.key && <span className="mobile-menu-check">✓</span>}
            </button>
          );
        })}
        <div className="mobile-menu-divider" />
        <button className="mobile-menu-item" id="mobileMenuRegion">
          <span className="mobile-menu-item-icon">🌐</span>
          <span className="mobile-menu-item-label">{t('components.deckgl.views.global')}</span>
          <span className="mobile-menu-chevron">▸</span>
        </button>
        <button className="mobile-menu-item" id="mobileMenuMission">
          <span className="mobile-menu-item-icon">◎</span>
          <span className="mobile-menu-item-label">Mission</span>
          <span className="mobile-menu-chevron">▸</span>
        </button>
        <div className="mobile-menu-divider" />
        <button className="mobile-menu-item" id="mobileMenuSettings">
          <span className="mobile-menu-item-icon">⚙️</span>
          <span className="mobile-menu-item-label">{t('header.settings')}</span>
        </button>
        <button className="mobile-menu-item" id="mobileMenuTheme">
          <span className="mobile-menu-item-icon">{isDark ? '☀️' : '🌙'}</span>
          <span className="mobile-menu-item-label">{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>
        <a
          className="mobile-menu-item"
          href="https://x.com/eliehabib"
          target="_blank"
          rel="noopener"
        >
          <span className="mobile-menu-item-icon">
            <svg className="x-logo" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </span>
          <span className="mobile-menu-item-label">@eliehabib</span>
        </a>
        <div className="mobile-menu-divider" />
        <div className="mobile-menu-footer-links">
          {REFERENCE_LINKS.map((l) => refLink(l.path, l.label))}
          <a
            href={isDesktop ? 'https://www.worldmonitor.app/pro#pricing' : '/pro#pricing'}
            target="_blank"
            rel="noopener"
          >
            Pricing
          </a>
          <a
            href={
              isDesktop ? 'https://worldmonitor.app/blog/' : 'https://www.worldmonitor.app/blog/'
            }
            target="_blank"
            rel="noopener"
          >
            Blog
          </a>
          <a
            href={isDesktop ? 'https://worldmonitor.app/docs' : 'https://www.worldmonitor.app/docs'}
            target="_blank"
            rel="noopener"
          >
            Docs
          </a>
          <a href="https://status.worldmonitor.app/" target="_blank" rel="noopener">
            Status
          </a>
        </div>
        <div className="mobile-menu-version">v{__APP_VERSION__}</div>
      </nav>

      {/* Region bottom sheet */}
      <div className="region-sheet-backdrop" id="regionSheetBackdrop" />
      <div className="region-bottom-sheet" id="regionBottomSheet">
        <div className="region-sheet-header">{t('header.selectRegion')}</div>
        <div className="region-sheet-divider" />
        {REGION_OPTIONS.map((r) => (
          <button
            key={r.value}
            className={`region-sheet-option${r.value === 'global' ? ' active' : ''}`}
            data-region={r.value}
          >
            <span>{t(r.labelKey)}</span>
            <span className="region-sheet-check">{r.value === 'global' ? '✓' : ''}</span>
          </button>
        ))}
      </div>

      <div className="dashboard-tabs-mount" id="panelTabsMount" />

      {/* Main content */}
      <main
        id="main"
        tabIndex={-1}
        className={`main-content${isDesktop ? ' desktop-grid' : ''}`}
      >
        <div
          className={`map-section${mapStartsCollapsed ? ' collapsed' : ''}`}
          id="mapSection"
        >
          <div className="panel-header">
            <div className="panel-header-left">
              <span className="panel-title">{mapTitle}</span>
            </div>
            <span className="header-clock" id="headerClock" translate="no" />
            <div className="map-header-actions">
              <div className="map-dimension-toggle" id="mapDimensionToggle">
                <button
                  className={`map-dim-btn${isGlobeMode ? '' : ' active'}`}
                  data-mode="flat"
                  title="2D Map"
                >
                  2D
                </button>
                <button
                  className={`map-dim-btn${isGlobeMode ? ' active' : ''}`}
                  data-mode="globe"
                  title="3D Globe"
                >
                  3D
                </button>
              </div>
              <button className="map-pin-btn" id="mapFullscreenBtn" title="Fullscreen">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                  <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                  <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                  <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              </button>
              <button className="map-pin-btn" id="mapPinBtn" title={t('header.pinMap')}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1v3.76z" />
                </svg>
              </button>
            </div>
          </div>
          <div id="mapReactMount" />
          {SITE_VARIANT === 'happy' && (
            <button className="tv-exit-btn" id="tvExitBtn">
              Exit TV Mode
            </button>
          )}
          <div className="map-resize-handle" id="mapResizeHandle" />
          <div className="map-bottom-grid" id="mapBottomGrid" />
        </div>
        <div className="map-width-resize-handle" id="mapWidthResizeHandle" />
        <div className="panels-grid" id="panelsGrid" role="tabpanel" />
      </main>

      {/* Mobile tab bar */}
      <nav className="mobile-tab-bar" id="mobileTabBar" aria-label="Primary">
        <button className="mobile-tab active" type="button" data-mobile-tab="today" aria-current="page">
          <span className="mobile-tab-icon" aria-hidden="true">
            ◉
          </span>
          <span>Today</span>
        </button>
        <button className="mobile-tab" type="button" data-mobile-tab="map">
          <span className="mobile-tab-icon" aria-hidden="true">
            ◎
          </span>
          <span>Map</span>
        </button>
        <button className="mobile-tab" type="button" data-mobile-tab="search">
          <span className="mobile-tab-icon" aria-hidden="true">
            ⌕
          </span>
          <span>Search</span>
        </button>
        <button className="mobile-tab" type="button" data-mobile-tab="alerts">
          <span className="mobile-tab-icon" aria-hidden="true">
            △
          </span>
          <span>Alerts</span>
        </button>
        <button className="mobile-tab" type="button" data-mobile-tab="more">
          <span className="mobile-tab-icon" aria-hidden="true">
            •••
          </span>
          <span>More</span>
        </button>
      </nav>

      {/* Footer */}
      <footer className="site-footer">
        <div className="site-footer-brand">
          <img
            src="/favico/android-chrome-96x96.png"
            alt=""
            width="28"
            height="28"
            loading="lazy"
            decoding="async"
            className="site-footer-icon"
          />
          <div className="site-footer-brand-text">
            <span className="site-footer-name">WORLD MONITOR</span>
            <span className="site-footer-sub">
              v{__APP_VERSION__} &middot;{' '}
              <a
                href="https://x.com/eliehabib"
                target="_blank"
                rel="noopener"
                className="site-footer-credit"
              >
                @eliehabib
              </a>
            </span>
          </div>
        </div>
        <nav>
          {REFERENCE_LINKS.map((l) => refLink(l.path, l.label))}
          <a
            href={isDesktop ? 'https://www.worldmonitor.app/pro#pricing' : '/pro#pricing'}
            target="_blank"
            rel="noopener"
          >
            Pricing
          </a>
          <a
            href={
              isDesktop ? 'https://worldmonitor.app/blog/' : 'https://www.worldmonitor.app/blog/'
            }
            target="_blank"
            rel="noopener"
          >
            Blog
          </a>
          <a
            href={isDesktop ? 'https://worldmonitor.app/docs' : 'https://www.worldmonitor.app/docs'}
            target="_blank"
            rel="noopener"
          >
            Docs
          </a>
          <a href="https://status.worldmonitor.app/" target="_blank" rel="noopener">
            Status
          </a>
          <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener">
            GitHub
          </a>
          <a href="https://discord.gg/re63kWKxaz" target="_blank" rel="noopener">
            Discord
          </a>
          <a href="https://x.com/worldmonitorai" target="_blank" rel="noopener">
            X
          </a>
          {!isDesktop && <span id="footerDownloadMount" />}
        </nav>
        <span className="site-footer-copy">&copy; {new Date().getFullYear()} World Monitor</span>
      </footer>
    </>
  );
}
