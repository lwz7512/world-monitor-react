import type { NewsItem } from '@/types';

let _news: NewsItem[] = [];
const _subs = new Set<(news: NewsItem[]) => void>();

export function setMonitorNews(news: NewsItem[]): void {
  _news = news;
  for (const sub of _subs) sub(_news);
}

export function getMonitorNews(): NewsItem[] { return _news; }

export function subscribeMonitorNews(cb: (news: NewsItem[]) => void): () => void {
  _subs.add(cb);
  return () => { _subs.delete(cb); };
}
