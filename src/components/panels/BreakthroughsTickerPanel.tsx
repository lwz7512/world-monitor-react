import { useState, useEffect } from 'react';
import type { NewsItem } from '@/types';
import { getHappyPanelData, subscribeHappyPanelData } from '@/services/happy-items-store';
import { sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

const SCIENCE_SOURCES = new Set(['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)']);

function selectBreakthroughs(items: NewsItem[]): NewsItem[] {
  return items.filter(item => SCIENCE_SOURCES.has(item.source) || item.happyCategory === 'science-health');
}

// ── Main panel content ────────────────────────────────────────────────────────

export function BreakthroughsTickerPanelContent() {
  const [items, setItems] = useState<NewsItem[]>(() => selectBreakthroughs(getHappyPanelData().curatedItems));

  useEffect(() => subscribeHappyPanelData((data) => setItems(selectBreakthroughs(data.curatedItems))), []);

  if (items.length === 0) {
    return (
      <div className="breakthroughs-ticker-wrapper">
        <div className="breakthroughs-ticker-track">
          <span className="ticker-item ticker-placeholder">
            {t('components.breakthroughsTicker.noData')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="breakthroughs-ticker-wrapper">
      <div className="breakthroughs-ticker-track">
        {/* First copy */}
        {items.map((item) => (
          <a
            key={item.link}
            className="ticker-item"
            href={sanitizeUrl(item.link)}
            target="_blank"
            rel="noopener"
          >
            <span className="ticker-item-source">{item.source}</span>
            <span className="ticker-item-title">{item.title}</span>
          </a>
        ))}
        {/* Duplicate for seamless CSS infinite-scroll loop */}
        {items.map((item, i) => (
          <a
            key={`dup-${i}`}
            className="ticker-item"
            href={sanitizeUrl(item.link)}
            target="_blank"
            rel="noopener"
            aria-hidden="true"
            tabIndex={-1}
          >
            <span className="ticker-item-source">{item.source}</span>
            <span className="ticker-item-title">{item.title}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export function BreakthroughsTickerPanel() {
  return (
    <PanelShell
      id="breakthroughs"
      title="Breakthroughs"
    >
      <BreakthroughsTickerPanelContent />
    </PanelShell>
  );
}
