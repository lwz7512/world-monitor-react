import { useState, useEffect } from 'react';
import type { NewsItem } from '@/types';
import { getHappyPanelData, subscribeHappyPanelData } from '@/services/happy-items-store';
import { generateSummary } from '@/services/summarization';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { effectivePubDateMs } from '@/services/feed-date';
import { PanelShell } from '@/components/PanelShell';

function selectDigestStories(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => effectivePubDateMs(b) - effectivePubDateMs(a)).slice(0, 5);
}

// ── Main panel content ────────────────────────────────────────────────────────

export function GoodThingsDigestPanelContent() {
  const [items, setItems] = useState<NewsItem[]>(() => selectDigestStories(getHappyPanelData().curatedItems));
  const [summaries, setSummaries] = useState<(string | null)[]>([]);
  const [loaded, setLoaded] = useState(() => getHappyPanelData().curatedItems.length > 0);

  // Subscribe to store updates
  useEffect(() => subscribeHappyPanelData((data) => {
    setItems(selectDigestStories(data.curatedItems));
    setLoaded(true);
  }), []);

  // Run summarization whenever items change
  useEffect(() => {
    if (items.length === 0) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    setSummaries(items.map(() => null));

    void Promise.allSettled(items.map(async (item, idx) => {
      if (signal.aborted) return;
      try {
        const result = await generateSummary([item.title, item.source], undefined, item.locationName);
        if (signal.aborted) return;
        const text = result?.summary ?? item.title.slice(0, 200);
        setSummaries(prev => { const next = [...prev]; next[idx] = text; return next; });
      } catch {
        if (!signal.aborted) {
          setSummaries(prev => { const next = [...prev]; next[idx] = item.title.slice(0, 200); return next; });
        }
      }
    }));

    return () => ctrl.abort();
  }, [items]);

  if (!loaded) {
    return <p className="digest-placeholder">Loading today&rsquo;s digest&hellip;</p>;
  }

  if (items.length === 0) {
    return <p className="digest-placeholder">{t('components.goodThingsDigest.noStories')}</p>;
  }

  return (
    <div className="digest-list">
      {items.map((item, i) => {
        const summary = summaries[i];
        return (
          <div key={`${item.link}-${i}`} className="digest-card">
            <span className="digest-card-number">{i + 1}</span>
            <div className="digest-card-body">
              <a
                className="digest-card-title"
                href={sanitizeUrl(item.link)}
                target="_blank"
                rel="noopener"
              >
                {item.title}
              </a>
              <span className="digest-card-source">{item.source}</span>
              <p className={`digest-card-summary${summary === null ? ' digest-card-summary--loading' : ''}`}>
                {summary === null
                  ? t('components.goodThingsDigest.summarizing')
                  : summary}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GoodThingsDigestPanel() {
  return (
    <PanelShell
      id="digest"
      title="5 Good Things"
    >
      <GoodThingsDigestPanelContent />
    </PanelShell>
  );
}
