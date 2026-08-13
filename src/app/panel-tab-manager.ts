import type { AppContext } from '@/app/app-context';
import type { PanelConfig } from '@/types';
import { isProUser, isProTierResolved, loadWidgets } from '@/services/widget-store';
import {
  panelGateStateChanged,
  sweepLegacyDisabledCustomWidgets,
} from '@/app/free-tier-gate';
import {
  ALL_PANELS,
  STORAGE_KEYS,
  SITE_VARIANT,
  enforceFreePanelLimit,
  getEffectivePanelConfig,
  isPanelInVariantDefaults,
} from '@/config';
import {
  loadTabsState,
  saveTabsState,
  generateTabId,
  buildDefaultTabPanels,
} from '@/services/tab-store';
import type { PanelTab, TabsState } from '@/services/tab-store';
import { PanelTabBar, tabCapGateCopy } from '@/components/PanelTabBar';
import { evaluateTabCap, exportLockToGateReason } from '@/services/gates/export';
import { primeExportGateActivation } from '@/services/gates/export-resolver';
import type { TabCapVerdict } from '@/services/gates/export-resolver';
import { trackGateHit } from '@/services/analytics';
import { resolveGateAction } from '@/services/panel-gating';
import { saveToStorage, showToast } from '@/utils';
import { t } from '@/services/i18n';
import { getAuthState } from '@/services/auth-state';

const CW_PRO_GATE_TAB_RECOVERY_KEY = 'worldmonitor-cw-pro-gate-tab-recovery-v1';

export interface PanelTabManagerCallbacks {
  savePanelOrder(): void;
  getResolvedPanelOrder(): string[];
  getBottomSetMemory(): Set<string>;
  isFreeTierFallbackActive(): boolean;
  applyPanelSettings(): void;
  applySavedPanelOrder(): void;
  mountLiveNewsIfReady(): void;
  scheduleLoadAllData(): void;
}

export class PanelTabManager {
  private panelTabBar: PanelTabBar | null = null;
  private tabsState: TabsState | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly callbacks: PanelTabManagerCallbacks,
  ) {}

  getTabsState(): TabsState | null {
    return this.tabsState;
  }

  init(mount: HTMLElement): void {
    let state = loadTabsState();
    if (!state) {
      // First run — wrap the user's current layout in an initial tab so
      // nothing changes visually until they create a second tab.
      const initial: PanelTab = {
        id: generateTabId(),
        name: t('dashboardTabs.defaultName'),
        ...this.captureCurrentTabState(),
      };
      state = { activeTabId: initial.id, tabs: [initial] };
      saveTabsState(state);
    }
    this.tabsState = state;
    // Clamp stored snapshots to the current free-tier cap so a workspace saved
    // while Pro (or persisted before the cap existed) can't re-enable an
    // over-cap layout when the user later switches to it. Skips itself while
    // the tier is unresolved; the App-owned fallback counts as a settled free
    // answer and also re-runs this method for tabs not yet opened.
    this.healStoredTabSnapshots();

    this.panelTabBar = new PanelTabBar(() => this.tabsState!, {
      onSelect: (id) => this.switchToTab(id),
      onAdd: () => this.addTab(),
      onRename: (id, name) => this.renameTab(id, name),
      onDelete: (id) => this.deleteTab(id),
    });
    mount.appendChild(this.panelTabBar.getElement());
    this.updateTabCapLock();
  }

  /**
   * Reconcile every stored tab snapshot against the current entitlement.
   *
   * Persisting a free-tier clamp while the tier is still unknown is the same
   * bug App.enforceFreeTierLimits defers around: a Pro user's custom widgets
   * would be written out of their saved workspaces on every load. Bail out
   * until the answer is real or the bounded free fallback fires; App calls
   * this again from the auth and entitlement callbacks, and
   * applyTabPanelState re-clamps on switch.
   */
  healStoredTabSnapshots(): void {
    const state = this.tabsState;
    if (!state || !this.isProTierResolvedOrFallback()) return;

    const pro = isProUser();
    let healedSnapshots = pro ? this.restoreLegacyCustomWidgetTabs(state) : false;
    for (const tab of state.tabs) {
      const clamped = enforceFreePanelLimit(tab.panelSettings, pro);
      if (this.panelSettingsEnabledStateChanged(tab.panelSettings, clamped)) {
        healedSnapshots = true;
      }
      tab.panelSettings = clamped;
    }
    if (healedSnapshots) saveTabsState(state);
  }

  /**
   * Tab-cap state for the CURRENT tab count (plan 2026-07-25-001, KTD8).
   * Pushes the locked/unlocked state into the tab bar and returns the verdict
   * so `addTab` can enforce it without resolving twice.
   *
   * CREATION-ONLY: nothing here removes a tab. A user sitting above their cap
   * (downgrade, lowered allowance, tabs created during a null-snapshot window)
   * keeps every tab they have — only the "+" locks.
   */
  updateTabCapLock(): TabCapVerdict {
    const verdict = evaluateTabCap(getAuthState(), this.tabsState?.tabs.length ?? 0);
    if (verdict.allowed) {
      // Only a would-be-capped user pays for the catalog probe; the cap stays
      // inactive until Pro Business is provably purchasable, so the limit and
      // the tier flip together (R10). Single-flight and shared with U5.
      if (verdict.pendingActivation) {
        void primeExportGateActivation().then((active) => {
          if (active && !this.ctx.isDestroyed) this.updateTabCapLock();
        });
      }
      this.panelTabBar?.setAddLock(null);
      return verdict;
    }
    const reason = exportLockToGateReason(verdict.reason);
    this.panelTabBar?.setAddLock({
      copy: tabCapGateCopy(reason, verdict.cap),
      onAction: resolveGateAction(reason, { openAuthModal: () => this.ctx.authModal?.open() }),
    });
    return verdict;
  }

  destroy(): void {
    this.panelTabBar?.destroy();
    this.panelTabBar = null;
    this.tabsState = null;
  }

  private isProTierResolvedOrFallback(): boolean {
    return isProTierResolved() || this.callbacks.isFreeTierFallbackActive() === true;
  }

  /**
   * Repair pre-`proGated` widget damage in saved tabs once per browser.
   *
   * App's global recovery can run before panel tabs initialize, so tabs own a
   * separate marker. The same ambiguity applies here: markerless disabled
   * widgets may be deliberate hides, which is why this sweep is bounded to one
   * migration pass rather than being re-run on every entitlement refresh.
   */
  private restoreLegacyCustomWidgetTabs(state: TabsState): boolean {
    try {
      if (localStorage.getItem(CW_PRO_GATE_TAB_RECOVERY_KEY)) return false;

      const ownedWidgetIds = new Set(loadWidgets().map((widget) => widget.id));
      let changed = false;
      for (const tab of state.tabs) {
        const restored = sweepLegacyDisabledCustomWidgets(tab.panelSettings, ownedWidgetIds);
        if (panelGateStateChanged(tab.panelSettings, restored)) changed = true;
        tab.panelSettings = restored;
      }
      localStorage.setItem(CW_PRO_GATE_TAB_RECOVERY_KEY, 'done');
      return changed;
    } catch {
      // Persistence-only migration; blocked storage leaves the tab usable.
      return false;
    }
  }

  private panelSettingsEnabledStateChanged(
    before: Record<string, PanelConfig>,
    after: Record<string, PanelConfig>,
  ): boolean {
    return panelGateStateChanged(before, after);
  }

  /** Capture the live panel state (settings + order) for a tab snapshot. */
  private captureCurrentTabState(): Pick<PanelTab, 'panelSettings' | 'panelOrder' | 'bottomSet'> {
    // Persist the live DOM order first so the snapshot reflects any drags.
    this.callbacks.savePanelOrder();
    return {
      panelSettings: JSON.parse(JSON.stringify(this.ctx.panelSettings)) as Record<string, PanelConfig>,
      panelOrder: [...this.callbacks.getResolvedPanelOrder()],
      bottomSet: Array.from(this.callbacks.getBottomSetMemory()),
    };
  }

  /** Refresh the active tab's snapshot from live state (called on switch-away). */
  private snapshotActiveTab(): void {
    if (!this.tabsState) return;
    const active = this.tabsState.tabs.find((t) => t.id === this.tabsState!.activeTabId);
    if (!active) return;
    Object.assign(active, this.captureCurrentTabState());
  }

  private switchToTab(tabId: string): void {
    if (!this.tabsState || tabId === this.tabsState.activeTabId) return;
    const target = this.tabsState.tabs.find((t) => t.id === tabId);
    if (!target) return;

    this.snapshotActiveTab();
    this.tabsState.activeTabId = tabId;
    saveTabsState(this.tabsState);

    this.applyTabPanelState(target.panelSettings, target.panelOrder, target.bottomSet);
    this.panelTabBar?.refresh();
  }

  private addTab(): void {
    if (!this.tabsState) return;

    const verdict = this.updateTabCapLock();
    if (!verdict.allowed) {
      // The metric fires on a blocked CLICK, never on render — a control
      // nobody reached for is not a gate hit.
      trackGateHit('dashboard-tab');
      this.panelTabBar?.showAddLockNotice();
      return;
    }

    this.snapshotActiveTab();

    const defaults = buildDefaultTabPanels(this.ctx.panelSettings);
    // The variant default set can exceed FREE_MAX_PANELS (e.g. 81 panels in the
    // full variant); clamp it to the free-tier cap so a new tab can't bypass
    // the limit that settings/search/boot all enforce.
    const tab: PanelTab = {
      id: generateTabId(),
      name: t('dashboardTabs.newTabName'),
      // Same unresolved-tier caveat as applyTabPanelState: clamping a new tab
      // before the entitlement is known bakes a free-tier layout into a Pro
      // user's workspace, and the count clamp carries no marker to undo. Once
      // the bounded fallback fires, the tier is settled enough to clamp.
      panelSettings: this.isProTierResolvedOrFallback()
        ? enforceFreePanelLimit(defaults.panelSettings, isProUser())
        : defaults.panelSettings,
      panelOrder: defaults.panelOrder,
      bottomSet: [],
    };
    this.tabsState.tabs.push(tab);
    this.tabsState.activeTabId = tab.id;
    saveTabsState(this.tabsState);

    this.applyTabPanelState(tab.panelSettings, tab.panelOrder, tab.bottomSet);
    this.panelTabBar?.refresh();
    // The new tab may have consumed the last slot — lock the control now
    // rather than on the next entitlement emission.
    this.updateTabCapLock();
    showToast(t('dashboardTabs.newTabCreated'));
  }

  private renameTab(tabId: string, name: string): void {
    if (!this.tabsState) return;
    const tab = this.tabsState.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    tab.name = name;
    saveTabsState(this.tabsState);
    this.panelTabBar?.refresh();
  }

  private deleteTab(tabId: string): void {
    if (!this.tabsState || this.tabsState.tabs.length <= 1) return;
    const idx = this.tabsState.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const wasActive = this.tabsState.activeTabId === tabId;
    const [removed] = this.tabsState.tabs.splice(idx, 1);

    if (wasActive) {
      const fallback = this.tabsState.tabs[Math.max(0, idx - 1)]!;
      this.tabsState.activeTabId = fallback.id;
      saveTabsState(this.tabsState);
      this.applyTabPanelState(fallback.panelSettings, fallback.panelOrder, fallback.bottomSet);
    } else {
      saveTabsState(this.tabsState);
    }
    this.panelTabBar?.refresh();
    // Deleting frees a slot: a capped user drops back under the limit.
    this.updateTabCapLock();
    showToast(t('dashboardTabs.tabDeleted', { name: removed!.name }));
  }

  /**
   * Load a tab's panel snapshot into the live global state and re-apply
   * the layout. Mirrors the mission-preset apply pipeline (panels only —
   * map layers, view, and time range stay global across tabs).
   */
  private applyTabPanelState(
    panelSettings: Record<string, PanelConfig>,
    panelOrder: string[],
    bottomSet: string[],
  ): void {
    const isDynamicPanel = (k: string) =>
      !ALL_PANELS[k] && (k === 'runtime-config' || k.startsWith('cw-') || k.startsWith('mcp-'));

    const next: Record<string, PanelConfig> = {};
    for (const [key, config] of Object.entries(panelSettings)) {
      next[key] = { ...config };
    }
    // Carry over panels missing from the snapshot: dynamic panels (custom
    // widgets / MCP / desktop config created after the snapshot) keep their
    // current config so they don't get orphaned visible-but-untracked;
    // panels added to the app since the snapshot seed from variant defaults
    // (same formula as the App.ts settings merge).
    for (const [key, config] of Object.entries(this.ctx.panelSettings)) {
      if (next[key]) continue;
      if (isDynamicPanel(key)) {
        next[key] = { ...config };
      } else {
        const effective = getEffectivePanelConfig(key, SITE_VARIANT);
        next[key] = { ...effective, enabled: isPanelInVariantDefaults(key) && effective.enabled };
      }
    }

    // Final free-tier guarantee: this is the only path that writes a tab's
    // panel selection into STORAGE_KEYS.panels, so clamping here means no tab
    // operation (add / switch / delete-fallback) can ever persist an over-cap
    // workspace, regardless of how the snapshot was produced.
    //
    // Unless the tier isn't known yet and the bounded fallback has not fired —
    // a tab click can land inside the same unresolved-session window the boot
    // clamp defers around. Skipping the clamp leaves an over-cap workspace
    // live for at most that window; App re-runs enforcement (and
    // healStoredTabSnapshots) when the entitlement resolves or the fallback
    // settles the account as free.
    const capped = this.isProTierResolvedOrFallback()
      ? enforceFreePanelLimit(next, isProUser())
      : next;

    this.ctx.panelSettings = capped;
    saveToStorage(STORAGE_KEYS.panels, capped);
    saveToStorage(this.ctx.PANEL_ORDER_KEY, panelOrder);
    saveToStorage(this.ctx.PANEL_ORDER_KEY + '-bottom-set', bottomSet);

    this.callbacks.applyPanelSettings();
    this.callbacks.applySavedPanelOrder();
    this.ctx.unifiedSettings?.refreshPanelToggles();
    this.callbacks.mountLiveNewsIfReady();
    this.callbacks.scheduleLoadAllData();
  }
}
