import type { AppContext } from '@/app/app-context';
import { saveToStorage } from '@/utils';
import {
  addResponsiveZoneListener,
  removeResponsiveZoneListener,
  type ResponsiveZoneListener,
} from '@/app/responsive-zone-listener';

export class PanelOrderManager {
  resolvedPanelOrder: string[] = [];
  bottomSetMemory: Set<string> = new Set();
  private wasUltraWide = false;
  private responsiveZoneListener: ResponsiveZoneListener | null = null;

  constructor(private readonly ctx: AppContext) {}

  initResponsiveZoneListener(): void {
    removeResponsiveZoneListener(this.responsiveZoneListener);
    this.responsiveZoneListener = addResponsiveZoneListener(
      window,
      this.getUltraWideMinWidth(),
      () => this.ensureCorrectZones(),
    );
  }

  destroyResponsiveZoneListener(): void {
    removeResponsiveZoneListener(this.responsiveZoneListener);
    this.responsiveZoneListener = null;
  }

  initZoneState(effectiveUltraWide: boolean): void {
    this.wasUltraWide = effectiveUltraWide;
  }

  getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v: unknown) => typeof v === 'string') as string[];
    } catch {
      return [];
    }
  }

  getSavedBottomSet(): Set<string> {
    try {
      const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY + '-bottom-set');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return new Set(parsed.filter((v: unknown) => typeof v === 'string'));
        }
      }
    } catch { /* ignore */ }
    try {
      const legacy = localStorage.getItem(this.ctx.PANEL_ORDER_KEY + '-bottom');
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed)) {
          const bottomIds = parsed.filter((v: unknown) => typeof v === 'string') as string[];
          const set = new Set(bottomIds);
          // Merge old sidebar + bottom into unified PANEL_ORDER_KEY
          const sidebarOrder = this.getSavedPanelOrder();
          const seen = new Set(sidebarOrder);
          const unified = [...sidebarOrder];
          for (const id of bottomIds) {
            if (!seen.has(id)) { unified.push(id); seen.add(id); }
          }
          localStorage.setItem(this.ctx.PANEL_ORDER_KEY, JSON.stringify(unified));
          localStorage.setItem(this.ctx.PANEL_ORDER_KEY + '-bottom-set', JSON.stringify([...set]));
          localStorage.removeItem(this.ctx.PANEL_ORDER_KEY + '-bottom');
          return set;
        }
      }
    } catch { /* ignore */ }
    return new Set();
  }

  savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    const bottomGrid = document.getElementById('mapBottomGrid');
    if (!grid || !bottomGrid) return;

    const sidebarIds = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);

    const bottomIds = Array.from(bottomGrid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);

    const allOrder = this.buildUnifiedOrder(sidebarIds, bottomIds);
    this.resolvedPanelOrder = allOrder;
    saveToStorage(this.ctx.PANEL_ORDER_KEY, allOrder);
    saveToStorage(this.ctx.PANEL_ORDER_KEY + '-bottom-set', Array.from(this.bottomSetMemory));
  }

  private buildUnifiedOrder(sidebarIds: string[], bottomIds: string[]): string[] {
    const presentIds = [...sidebarIds, ...bottomIds];
    const uniqueIds: string[] = [];
    const seen = new Set<string>();

    presentIds.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      uniqueIds.push(id);
    });

    const previousOrder = new Map<string, number>();
    this.resolvedPanelOrder.forEach((id, index) => {
      if (seen.has(id) && !previousOrder.has(id)) {
        previousOrder.set(id, index);
      }
    });
    uniqueIds.forEach((id, index) => {
      if (!previousOrder.has(id)) {
        previousOrder.set(id, this.resolvedPanelOrder.length + index);
      }
    });

    const edges = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    uniqueIds.forEach((id) => {
      edges.set(id, new Set());
      indegree.set(id, 0);
    });

    const addConstraints = (ids: string[]) => {
      for (let i = 1; i < ids.length; i++) {
        const prev = ids[i - 1]!;
        const next = ids[i]!;
        if (prev === next || !seen.has(prev) || !seen.has(next)) continue;
        const nextIds = edges.get(prev);
        if (!nextIds || nextIds.has(next)) continue;
        nextIds.add(next);
        indegree.set(next, (indegree.get(next) ?? 0) + 1);
      }
    };

    addConstraints(sidebarIds);
    addConstraints(bottomIds);

    const compareIds = (a: string, b: string) =>
      (previousOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (previousOrder.get(b) ?? Number.MAX_SAFE_INTEGER);

    const available = uniqueIds
      .filter((id) => (indegree.get(id) ?? 0) === 0)
      .sort(compareIds);
    const merged: string[] = [];

    while (available.length > 0) {
      const current = available.shift()!;
      merged.push(current);

      edges.get(current)?.forEach((next) => {
        const nextIndegree = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, nextIndegree);
        if (nextIndegree === 0) {
          available.push(next);
        }
      });
      available.sort(compareIds);
    }

    return merged.length === uniqueIds.length
      ? merged
      : uniqueIds.sort(compareIds);
  }

  applySavedPanelOrder(
    panelOrder: string[] | undefined,
    getPanelElement: (key: string) => HTMLElement | null,
  ): void {
    const grid = document.getElementById('panelsGrid');
    const bottomGrid = document.getElementById('mapBottomGrid');
    if (!grid || !bottomGrid) return;

    const activePanelKeys = Object.keys(this.ctx.panelSettings).filter(k => k !== 'map');
    const savedOrder = (panelOrder ?? this.getSavedPanelOrder()).filter(k => activePanelKeys.includes(k));
    if (savedOrder.length === 0) return;

    const seen = new Set<string>();
    const allOrder: string[] = [];
    const appendUnique = (key: string) => {
      if (seen.has(key) || !activePanelKeys.includes(key)) return;
      seen.add(key);
      allOrder.push(key);
    };
    savedOrder.forEach(appendUnique);
    this.resolvedPanelOrder.forEach(appendUnique);
    activePanelKeys.forEach(appendUnique);

    this.bottomSetMemory = panelOrder ? new Set<string>() : this.getSavedBottomSet();
    this.resolvedPanelOrder = allOrder;

    const effectiveUltraWide = this.getEffectiveUltraWide();
    this.wasUltraWide = effectiveUltraWide;
    const sidebarOrder = effectiveUltraWide
      ? allOrder.filter(k => !this.bottomSetMemory.has(k))
      : allOrder;
    const bottomOrder = effectiveUltraWide
      ? allOrder.filter(k => this.bottomSetMemory.has(k))
      : [];

    const firstAddBlock = grid.querySelector('.add-panel-block');
    sidebarOrder.forEach((key) => {
      const el = getPanelElement(key);
      if (!el) return;
      if (firstAddBlock) grid.insertBefore(el, firstAddBlock);
      else grid.appendChild(el);
    });

    bottomOrder.forEach((key) => {
      const el = getPanelElement(key);
      if (el) bottomGrid.appendChild(el);
    });
  }

  insertByOrder(grid: HTMLElement, el: HTMLElement, key: string): void {
    const idx = this.resolvedPanelOrder.indexOf(key);
    if (idx === -1) { grid.appendChild(el); return; }
    for (let i = idx + 1; i < this.resolvedPanelOrder.length; i++) {
      const nextKey = this.resolvedPanelOrder[i]!;
      const nextEl = grid.querySelector(`[data-panel="${CSS.escape(nextKey)}"]`);
      // `parentNode === grid` guard: querySelector returns nodes that match
      // ANY descendant, but a concurrent DOM mutation (browser extension,
      // overlapping resize event mid-iteration) can move/remove nextEl
      // between this read and the insertBefore call below — at which point
      // insertBefore throws `NotFoundError: The node before which the new
      // node is to be inserted is not a child of this node.`
      // (WORLDMONITOR-Q6). If the reference moved, fall through to the
      // appendChild path so the panel still lands in the grid.
      if (nextEl && nextEl.parentNode === grid) { grid.insertBefore(el, nextEl); return; }
    }
    grid.appendChild(el);
  }

  public ensureCorrectZones(): void {
    const effectiveUltraWide = this.getEffectiveUltraWide();

    if (effectiveUltraWide === this.wasUltraWide) return;
    this.wasUltraWide = effectiveUltraWide;

    const grid = document.getElementById('panelsGrid');
    const bottomGrid = document.getElementById('mapBottomGrid');
    if (!grid || !bottomGrid) return;

    if (!effectiveUltraWide) {
      const panelsInBottom = Array.from(bottomGrid.querySelectorAll('.panel')) as HTMLElement[];
      panelsInBottom.forEach(panelEl => {
        const id = panelEl.dataset.panel;
        if (!id) return;
        this.insertByOrder(grid, panelEl, id);
      });
    } else {
      this.bottomSetMemory.forEach(id => {
        const el = grid.querySelector(`[data-panel="${CSS.escape(id)}"]`);
        if (el) {
          this.insertByOrder(bottomGrid, el as HTMLElement, id);
        }
      });
    }
  }

  private getUltraWideMinWidth(): number {
    return this.ctx.isDesktopApp ? 900 : 1600;
  }

  getEffectiveUltraWide(): boolean {
    const mapSection = document.getElementById('mapSection');
    const mapEnabled = !mapSection?.classList.contains('hidden');
    return window.innerWidth >= this.getUltraWideMinWidth() && mapEnabled;
  }
}
