import { useEffect } from 'react';
import { PlaybackControl } from '@/components/PlaybackControl';
import { evaluatePlaybackGate } from '@/services/gates/playback';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { onEntitlementChange } from '@/services/entitlements';
import { trackGateHit } from '@/services/analytics';
import type { ClusteredEvent } from '@/types';
import type { DashboardSnapshot } from '@/services/storage';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { useAppContextMaybe } from '@/context/AppContext';
import { getAllNewsStores } from '@/services/news-panel-registry';

export function usePlaybackControl(): void {
  const ctx = useAppContextMaybe();
  useEffect(() => {
    if (!ctx) return;
    const actions = getPublishedAppActions();
    if (!actions) return;

    const restoreSnapshot = (snapshot: DashboardSnapshot): void => {
      // Replay parks every news panel on a loading state and never refills it —
      // leaving playback calls loadAllData() to do that. Its news task is skipped
      // when the category set is unchanged (#5376), which replay does not touch,
      // so drop the record here and the exit reload happens.
      actions.invalidateNewsHydration();
      for (const store of getAllNewsStores().values()) {
        store.showLoading();
      }
      ctx.latestClusters = snapshot.events as ClusteredEvent[];
      ctx.latestPredictions = snapshot.predictions.map((p, i) => ({
        id: `snap-${i}`,
        title: p.title,
        yesPrice: p.yesPrice,
        noPrice: 100 - p.yesPrice,
        volume24h: 0,
        liquidity: 0,
      }));
      // PredictionPanel is self-fetching via usePanelData; no push needed.
      ctx.map?.setHotspotLevels(snapshot.hotspotLevels);
    };

    // Always create — show/hide reactively via auth state subscription below.
    ctx.playbackControl = new PlaybackControl();
    ctx.playbackControl.onSnapshot((snapshot) => {
      if (snapshot) {
        ctx.isPlaybackMode = true;
        restoreSnapshot(snapshot);
      } else {
        ctx.isPlaybackMode = false;
        void actions.loadAllData();
      }
    });

    const el = ctx.playbackControl.getElement();
    const headerRight = ctx.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(el, headerRight.firstChild);
    }

    // #5632: gate on the entitlement chain, NOT `user.role === 'pro'` — nothing
    // writes Clerk publicMetadata, so that field read 'free' for paying
    // subscribers and the control rendered for nobody.
    let gateHitTracked = false;
    const applyGate = (): void => {
      if (ctx.isDestroyed) return;
      const verdict = evaluatePlaybackGate(getAuthState());
      const visible = verdict === 'visible';
      el.style.display = visible ? '' : 'none';
      // Losing access mid-replay must also LEAVE playback. `display: none`
      // alone strands the dashboard on historical data — the "Live" button is
      // inside the element we just hid. No-ops unless playback is active.
      if (!visible) ctx.playbackControl?.exitPlayback();
      // Affirmative denials only, once per session. 'pending' also hides, but
      // counting it would tick the funnel on every page load — including for
      // subscribers whose control appears a moment later.
      if (verdict === 'denied' && !gateHitTracked) {
        gateHitTracked = true;
        trackGateHit('playback');
      }
    };
    applyGate();
    // BOTH subscriptions: the Convex entitlement watcher (services/entitlements.ts)
    // is a separate emitter from Clerk's, so an auth-only subscription never
    // re-runs when a snapshot lands after sign-in — exactly the post-checkout
    // unlock path.
    const unsubAuth = subscribeAuthState(() => applyGate());
    const unsubEntitlement = onEntitlementChange(() => applyGate());

    return () => {
      unsubAuth();
      unsubEntitlement();
      el.remove();
      ctx.playbackControl = null;
    };
  }, [ctx]);
}
