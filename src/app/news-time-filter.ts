import type { NewsItem } from '@/types';
import type { TimeRange } from '@/components/MapContainer';
import { effectivePubDateMs } from '@/services/feed-date';
import { getAllNewsStores } from '@/services/news-panel-registry';

export function filterItemsByTimeRange(
  items: NewsItem[],
  range: TimeRange = '7d',
): NewsItem[] {
  if (range === 'all') return items;
  const ranges: Record<string, number> = {
    '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000, '48h': 48 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000, 'all': Infinity,
  };
  const cutoff = Date.now() - (ranges[range] ?? Infinity);
  return items.filter((item) => {
    // Recency gate routed through effectivePubDateMs so pubDateMissing
    // items fail the cutoff check rather than falsely claiming freshness.
    // Items with NaN/Infinity/Invalid Date pubDates are ALSO excluded
    // (the helper sanitizes them to 0); previous behavior fell through
    // to `true` on non-finite, which included corrupt-stamp items in
    // narrow time windows. Treating untrustworthy timestamps uniformly
    // is the intentional shift — see data-loader.filterItemsByTimeRange.
    return effectivePubDateMs(item) >= cutoff;
  });
}

export function getTimeRangeLabel(range: TimeRange): string {
  const labels: Record<string, string> = {
    '1h': 'the last hour', '6h': 'the last 6 hours',
    '24h': 'the last 24 hours', '48h': 'the last 48 hours',
    '7d': 'the last 7 days', 'all': 'all time',
  };
  return labels[range] ?? 'the last 7 days';
}

export function applyTimeRangeFilterToNewsPanels(
  newsByCategory: Record<string, NewsItem[]>,
  currentTimeRange: TimeRange,
): void {
  const newsStores = getAllNewsStores();
  Object.entries(newsByCategory).forEach(([category, items]) => {
    const panel = newsStores.get(category);
    if (!panel) return;
    const filtered = filterItemsByTimeRange(items, currentTimeRange);
    if (filtered.length === 0 && items.length > 0) {
      panel.renderFilteredEmpty(`No items in ${getTimeRangeLabel(currentTimeRange)}`);
      return;
    }
    panel.renderNews(filtered);
  });
}
