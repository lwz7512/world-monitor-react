import type { NewsPanelStore } from '@/components/panels/NewsPanelContent';

const registry = new Map<string, NewsPanelStore>();

export function getNewsStore(id: string): NewsPanelStore | undefined {
  return registry.get(id);
}

export function getAllNewsStores(): Map<string, NewsPanelStore> {
  return registry;
}

export function registerNewsStore(id: string, store: NewsPanelStore): void {
  registry.set(id, store);
}

export function unregisterNewsStore(id: string): void {
  registry.delete(id);
}
