import type { AppContext } from '@/app/app-context';
import { showToast } from '@/utils';
import { overlayHistory, type OverlayId } from '@/utils/overlay-history';
import { CountryIntelManager } from '@/app/country-intel';

type SearchManager = import('@/app/search-manager').SearchManager;
type SignalModalInstance = import('@/components/SignalModal').SignalModal;

export async function waitForUiReady(ctx: AppContext, timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`UI did not initialise within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([ctx.uiReady, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export class SearchLauncher {
  private ctx: AppContext;
  private countryIntel: CountryIntelManager;
  private enablePanel: (panelId: string) => boolean;

  private searchManager: SearchManager | null = null;
  private searchManagerLoad: Promise<SearchManager> | null = null;
  private signalModalLoad: Promise<SignalModalInstance> | null = null;
  // Monotonic epoch: every openSearch() call supersedes earlier in-flight ones.
  // searchToggleDesiredOpen accumulates the net intent of rapid Cmd+K presses
  // while the lazy chunk loads (XOR: odd → open, even → cancel). (#4403 review)
  private openSearchEpoch = 0;
  private searchToggleDesiredOpen = false;
  private latestSearchAdsb: Parameters<SearchManager['updateFlightSource']>[0] = [];
  private latestSearchMilitary: Parameters<SearchManager['updateFlightSource']>[1] = [];

  constructor(
    ctx: AppContext,
    countryIntel: CountryIntelManager,
    enablePanel: (panelId: string) => boolean,
  ) {
    this.ctx = ctx;
    this.countryIntel = countryIntel;
    this.enablePanel = enablePanel;
  }

  ensureSignalModal(): Promise<SignalModalInstance> {
    if (this.ctx.signalModal) return Promise.resolve(this.ctx.signalModal);
    if (this.signalModalLoad) return this.signalModalLoad;

    this.signalModalLoad = import('@/components/SignalModal')
      .then(({ SignalModal }) => {
        if (this.ctx.isDestroyed) {
          throw new Error('App destroyed before signal modal loaded');
        }
        const signalModal = new SignalModal();
        signalModal.setLocationClickHandler((lat, lon) => {
          this.ctx.map?.setCenter(lat, lon, 4);
        });
        this.ctx.signalModal = signalModal;
        return signalModal;
      })
      .catch((err) => {
        this.signalModalLoad = null;
        throw err;
      });

    return this.signalModalLoad;
  }

  private ensureSearchManager(): Promise<SearchManager> {
    if (this.searchManager) return Promise.resolve(this.searchManager);
    if (this.searchManagerLoad) return this.searchManagerLoad;

    this.searchManagerLoad = import('@/app/search-manager')
      .then(({ SearchManager }) => {
        if (this.ctx.isDestroyed) {
          throw new Error('App destroyed before search manager loaded');
        }

        const manager = new SearchManager(this.ctx, {
          openCountryBriefByCode: (code, country) => {
            void this.countryIntel.openCountryBriefByCode(code, country).catch((err) => {
              console.error('[CountryBrief] Failed to open country brief:', err);
              this.ctx.map?.setRenderPaused(false);
              showToast('Country brief failed to open. Please try again.');
            });
          },
          enablePanel: (panelId) => this.enablePanel(panelId),
        });
        manager.init();
        manager.updateFlightSource(this.latestSearchAdsb, this.latestSearchMilitary);
        this.searchManager = manager;
        return manager;
      })
      .finally(() => {
        this.searchManagerLoad = null;
      });

    return this.searchManagerLoad;
  }

  updateSearchIndex(): void {
    this.searchManager?.updateSearchIndex();
  }

  updateFlightSource(
    adsb: Parameters<SearchManager['updateFlightSource']>[0],
    military: Parameters<SearchManager['updateFlightSource']>[1],
  ): void {
    this.latestSearchAdsb = adsb;
    this.latestSearchMilitary = military;
    this.searchManager?.updateFlightSource(adsb, military);
  }

  async openSearch(options: { toggle?: boolean; throwOnFailure?: boolean; replaceOverlayId?: OverlayId; historyPending?: boolean } = {}): Promise<void> {
    // Concurrency model: each press registers its intent, then claims a
    // monotonic epoch. After the lazy load resolves, only the latest epoch acts
    // — superseded presses bail. This yields one deterministic modal.open() for
    // any Cmd+K / button interleaving during the first load (replacing the prior
    // two-field pending-toggle bookkeeping), while preserving net-toggle parity:
    // the XOR flip happens BEFORE the epoch claim so every rapid Cmd+K still
    // counts (odd → open, even → cancel), even the ones that get superseded.
    let epoch = this.openSearchEpoch;
    const pendingId: OverlayId = 'search-pending';
    const pendingGate = options.historyPending
      ? overlayHistory.beginPending(pendingId, options.replaceOverlayId, () => {
          this.searchToggleDesiredOpen = false;
        })
      : null;
    try {
      await waitForUiReady(this.ctx);
      if (pendingGate && !pendingGate.isCurrent()) return;

      const existingModal = this.ctx.searchModal;
      if (options.toggle && existingModal?.isOpen()) {
        existingModal.close();
        return;
      }

      const togglingBeforeLoad = Boolean(options.toggle) && !this.searchManager;
      if (togglingBeforeLoad) {
        this.searchToggleDesiredOpen = !this.searchToggleDesiredOpen;
      }

      epoch = ++this.openSearchEpoch;
      const manager = await this.ensureSearchManager();
      if (this.openSearchEpoch !== epoch) return;
      if (pendingGate && !pendingGate.isCurrent()) return;

      const wantOpen = togglingBeforeLoad ? this.searchToggleDesiredOpen : true;
      if (!wantOpen) return;

      manager.updateSearchIndex();
      const modal = this.ctx.searchModal;
      if (!modal) throw new Error('Search modal is not initialised');
      modal.open(pendingGate ? pendingId : options.replaceOverlayId);
    } catch (error) {
      const actionWasCancelled = pendingGate !== null && !pendingGate.isCurrent();
      if (!this.ctx.isDestroyed && !actionWasCancelled) {
        console.warn('[search] Failed to load search manager:', error);
        if (!options.throwOnFailure) showToast('Search failed to load. Please try again.');
      }
      pendingGate?.cancel();
      if (options.throwOnFailure) throw error;
    } finally {
      // Reset the toggle accumulator once the latest press settles.
      if (this.openSearchEpoch === epoch) this.searchToggleDesiredOpen = false;
    }
  }
}
