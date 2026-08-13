import { useState, useEffect, useRef } from 'react';
import { getCSSColor } from '@/utils';
import { t } from '@/services/i18n';
import type { CountryScore } from '@/services/country-instability';
import { renderFollowButton } from '@/utils/follow-button';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { getFollowed, isFollowFeatureEnabled, subscribe as subscribeFollowed } from '@/services/followed-countries';
import { partitionByFollowed, shouldRenderSectionLabels } from '@/components/_cii-panel-partition';
import { getCiiState, subscribeCiiState } from '@/services/cii-store';
import { toCountryScore } from '@/services/cached-risk-scores';
import { PanelShell } from '@/components/PanelShell';

export const CII_METHODOLOGY_HREF = '/docs/methodology/cii-risk-scores';

function getLevelColor(level: CountryScore['level']): string {
  switch (level) {
    case 'critical': return getCSSColor('--semantic-critical');
    case 'high': return getCSSColor('--semantic-high');
    case 'elevated': return getCSSColor('--semantic-elevated');
    case 'normal': return getCSSColor('--semantic-normal');
    case 'low': return getCSSColor('--semantic-low');
  }
}

function getLevelEmoji(level: CountryScore['level']): string {
  switch (level) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'elevated': return '🟡';
    case 'normal': return '🟢';
    case 'low': return '⚪';
  }
}

function TrendArrow({ trend, change }: { trend: CountryScore['trend']; change: number }) {
  if (trend === 'rising') return <span className="trend-up">↑{change > 0 ? change : ''}</span>;
  if (trend === 'falling') return <span className="trend-down">↓{Math.abs(change)}</span>;
  return <span className="trend-stable">→</span>;
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  );
}

function FollowButtonHost({ countryCode, countryName }: { countryCode: string; countryName: string }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = renderFollowButton({ countryCode, countryName, size: 'sm' });
    setTrustedHtml(host, trustedHtml(handle.html, 'legacy direct innerHTML migration'));
    const teardown = handle.attach(host);
    return () => { try { teardown(); } catch { /* swallow */ } };
  }, [countryCode, countryName]);
  return (
    <span
      ref={hostRef}
      className="cii-follow-btn-host"
      data-code={countryCode}
      onClick={e => e.stopPropagation()}
    />
  );
}

function CIICountryRow({ country }: { country: CountryScore }) {
  const color = getLevelColor(country.level);
  const emoji = getLevelEmoji(country.level);
  return (
    <div
      className="cii-country"
      data-code={country.code}
      onClick={() => window.dispatchEvent(new CustomEvent('wm:cii-country-click', { detail: { code: country.code } }))}
    >
      <FollowButtonHost countryCode={country.code} countryName={country.name} />
      <div className="cii-header">
        <span className="cii-emoji">{emoji}</span>
        <span className="cii-name">{country.name}</span>
        <span className="cii-score">{country.score}</span>
        <TrendArrow trend={country.trend} change={country.change24h} />
        <button
          className="cii-share-btn"
          data-code={country.code}
          data-name={country.name}
          title={t('common.shareStory')}
          onClick={e => {
            e.stopPropagation();
            if (country.code && country.name) {
              window.dispatchEvent(new CustomEvent('wm:cii-share-story', { detail: { code: country.code, name: country.name } }));
            }
          }}
        >
          <ShareIcon />
        </button>
      </div>
      <div className="cii-bar-container">
        <div className="cii-bar" style={{ width: `${country.score}%`, background: color }} />
      </div>
      <div className="cii-components">
        <span title={t('common.unrest')}>U:{country.components.unrest}</span>
        <span title={t('common.conflict')}>C:{country.components.conflict}</span>
        <span title={t('common.security')}>S:{country.components.security}</span>
        <span title={t('common.information')}>I:{country.components.information}</span>
      </div>
    </div>
  );
}

function CIIList({ scores }: { scores: CountryScore[] }) {
  const followedCodes = isFollowFeatureEnabled() ? getFollowed() : [];
  const partition = partitionByFollowed(scores, followedCodes);
  const renderRow = (s: CountryScore) => (
    <CIICountryRow key={s.code} country={s} />
  );

  if (!shouldRenderSectionLabels(partition)) {
    return <div className="cii-list">{scores.map(renderRow)}</div>;
  }

  const { followed, unfollowed } = partition;
  return (
    <div className="cii-list">
      <div className="cii-section-label">{t('components.cii.sectionFollowing')}</div>
      {followed.map(renderRow)}
      <div className="cii-section-label">{t('components.cii.sectionAll')}</div>
      {unfollowed.map(renderRow)}
    </div>
  );
}

type CIIMode = 'loading' | 'data' | 'unavailable';

export function CIIPanelContent() {
  const [ciiState, setCiiState] = useState(getCiiState);
  const [, setFollowedTick] = useState(0);

  useEffect(() => subscribeCiiState(setCiiState), []);
  useEffect(() => subscribeFollowed(() => setFollowedTick(k => k + 1)), []);

  const mode: CIIMode = ciiState === null ? 'loading'
    : ciiState.type === 'unavailable' ? 'unavailable'
    : 'data';
  const scores = ciiState?.type === 'data'
    ? ciiState.cached.cii.map(toCountryScore).filter(s => s.score > 0)
    : [];
  const withData = scores.filter(s => s.score > 0);

  return (
    <div className="cii-panel-content">
      {mode === 'loading' && (
        <div className="panel-loading">{t('common.loading')}</div>
      )}
      {mode === 'unavailable' && (
        <>
          <div className="empty-state">{t('common.failedCII')}</div>
          <div className="cii-methodology-footer">
            <a href={CII_METHODOLOGY_HREF} target="_blank" rel="noopener noreferrer">
              {t('components.cii.methodologyLink')}
            </a>
          </div>
        </>
      )}
      {mode === 'data' && withData.length > 0 && (
        <>
          <CIIList scores={withData} />
          <div className="cii-methodology-footer">
            <a href={CII_METHODOLOGY_HREF} target="_blank" rel="noopener noreferrer">
              {t('components.cii.methodologyLink')}
            </a>
          </div>
        </>
      )}
    </div>
  );
}

export function CIIPanel() {
  return (
    <PanelShell
      id="cii"
      title={t('panels.cii')}
      infoTooltip={`${t('components.cii.infoTooltip')} ${t('components.cii.methodologyLink')}`}
      defaultRowSpan={2}
    >
      <CIIPanelContent />
    </PanelShell>
  );
}

