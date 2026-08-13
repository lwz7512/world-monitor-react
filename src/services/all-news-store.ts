import type { NewsItem } from '@/types';

let _allNews: NewsItem[] = [];

export function setAllNews(news: NewsItem[]): void { _allNews = news; }
export function getAllNews(): NewsItem[] { return _allNews; }
