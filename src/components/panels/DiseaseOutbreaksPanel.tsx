import { useState, useEffect } from 'react';
import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import { fetchDiseaseOutbreaks, type DiseaseOutbreakItem } from '@/services/disease-outbreaks';
import { isFollowed, subscribe as subscribeFollowed, isFollowFeatureEnabled } from '@/services/followed-countries';
import { toIso2 } from '@/utils/country-codes';
import { sanitizeUrl } from '@/utils/sanitize';
import { PanelShell } from '@/components/PanelShell';

function alertColor(level: string): string {
  if (level === 'alert') return '#e74c3c';
  if (level === 'warning') return '#e67e22';
  return '#f1c40f';
}

function alertLabel(level: string): string {
  if (level === 'alert') return t('components.diseaseOutbreaks.levels.alert');
  if (level === 'warning') return t('components.diseaseOutbreaks.levels.warning');
  return t('components.diseaseOutbreaks.levels.watch');
}

function relativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return t('components.diseaseOutbreaks.time.justNow');
  if (h < 24) return t('components.diseaseOutbreaks.time.hoursAgo', { count: h });
  const d = Math.floor(h / 24);
  return t('components.diseaseOutbreaks.time.daysAgo', { count: d });
}

function sortOutbreaks(outbreaks: DiseaseOutbreakItem[]): DiseaseOutbreakItem[] {
  const levelOrder = { alert: 0, warning: 1, watch: 2 };
  return [...outbreaks].sort((a, b) => {
    const la = levelOrder[a.alertLevel as keyof typeof levelOrder] ?? 3;
    const lb = levelOrder[b.alertLevel as keyof typeof levelOrder] ?? 3;
    if (la !== lb) return la - lb;
    return (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
  });
}

async function fetcher(_signal: AbortSignal): Promise<DiseaseOutbreakItem[]> {
  const data = await fetchDiseaseOutbreaks();
  return sortOutbreaks(data.outbreaks ?? []);
}

export function DiseaseOutbreaksPanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 15 * 60 * 1000 });
  const [filter, setFilter] = useState('');
  const [followedOnly, setFollowedOnly] = useState(false);
  const [, setFollowedTick] = useState(0);

  useEffect(() => {
    return subscribeFollowed(() => setFollowedTick(t => t + 1));
  }, []);

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('components.diseaseOutbreaks.errors.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  const outbreaks = data;
  const alertLevels = new Set(['alert', 'warning', 'watch']);
  let filtered = filter
    ? alertLevels.has(filter)
      ? outbreaks.filter(o => o.alertLevel === filter)
      : outbreaks.filter(o =>
          o.disease.toLowerCase().includes(filter) ||
          o.location.toLowerCase().includes(filter) ||
          (o.countryCode?.toLowerCase().includes(filter) ?? false)
        )
    : outbreaks;

  if (followedOnly) {
    filtered = filtered.filter(o => {
      const code = toIso2(o.countryCode ?? '');
      return code ? isFollowed(code) : false;
    });
  }

  const counts = { alert: 0, warning: 0, watch: 0 };
  for (const o of outbreaks) {
    const k = o.alertLevel as keyof typeof counts;
    if (k in counts) counts[k]++;
  }

  const toggleFilter = (level: string) => setFilter(f => f === level ? '' : level);
  const emptyMessage = followedOnly
    ? 'No items in your followed countries. Add countries by tapping the star, or turn off this filter.'
    : t('components.diseaseOutbreaks.empty');

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {counts.alert > 0 && (
          <button onClick={() => toggleFilter('alert')} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(231,76,60,0.4)', background: filter === 'alert' ? 'rgba(231,76,60,0.2)' : 'transparent', color: '#e74c3c', cursor: 'pointer' }}>
            {t('components.diseaseOutbreaks.filters.alert', { count: counts.alert })}
          </button>
        )}
        {counts.warning > 0 && (
          <button onClick={() => toggleFilter('warning')} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(230,126,34,0.4)', background: filter === 'warning' ? 'rgba(230,126,34,0.2)' : 'transparent', color: '#e67e22', cursor: 'pointer' }}>
            {t('components.diseaseOutbreaks.filters.warning', { count: counts.warning })}
          </button>
        )}
        {counts.watch > 0 && (
          <button onClick={() => toggleFilter('watch')} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(241,196,15,0.4)', background: filter === 'watch' ? 'rgba(241,196,15,0.2)' : 'transparent', color: '#f1c40f', cursor: 'pointer' }}>
            {t('components.diseaseOutbreaks.filters.watch', { count: counts.watch })}
          </button>
        )}
        {isFollowFeatureEnabled() && (
          <button onClick={() => setFollowedOnly(v => !v)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px solid rgba(99,179,237,0.4)', background: followedOnly ? 'rgba(99,179,237,0.2)' : 'transparent', color: 'var(--accent-primary)', cursor: 'pointer' }}>
            ★ Followed
          </button>
        )}
      </div>
      <div style={{ overflowY: 'auto', maxHeight: 420 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>{emptyMessage}</div>
        ) : filtered.map((o, i) => {
          const color = alertColor(o.alertLevel);
          const label = alertLabel(o.alertLevel);
          const age = relativeTime(o.publishedAt ?? 0);
          return (
            <div key={`${o.disease}-${o.location}-${i}`} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: `${color}22`, color, marginTop: 1 }}>{label}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{o.disease}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{o.location}</div>
                  {o.summary && (
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.4 }}>
                      {o.summary.slice(0, 120)}{o.summary.length > 120 ? '…' : ''}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                    {o.sourceUrl ? (
                      <a href={sanitizeUrl(o.sourceUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: 9 }}>
                        {o.sourceName || t('components.diseaseOutbreaks.sourceFallback')}
                      </a>
                    ) : o.sourceName ? (
                      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{o.sourceName}</span>
                    ) : null}
                    {age && <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{age}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: 'var(--text-dim)' }}>{t('components.diseaseOutbreaks.attribution')}</div>
    </div>
  );
}

export function DiseaseOutbreaksPanel() {
  return (
    <PanelShell
      id="disease-outbreaks"
      title={t('components.diseaseOutbreaks.title')}
      infoTooltip={t('components.diseaseOutbreaks.infoTooltip')}
    >
      <DiseaseOutbreaksPanelContent />
    </PanelShell>
  );
}
