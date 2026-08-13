import { useEffect } from 'react';
import { useAppContextMaybe } from '@/context/AppContext';
import { getPublishedAppActions } from '@/services/app-actions-bridge';
import { subscribeAuthState, getAuthState } from '@/services/auth-state';
import {
  onEntitlementChange,
  destroyEntitlementSubscription,
  resetEntitlementState,
  initEntitlementSubscription,
} from '@/services/entitlements';
import { hasPremiumAccess } from '@/services/panel-gating';
import { startAccountAuthHandoff } from '@/app/account-auth-handoff';
import {
  getStoredAnonId,
  getFreshStoredAnonClaimToken,
  clearStoredAnonIdentity,
} from '@/services/anonymous-identity-storage';
import {
  getConvexClient,
  getConvexApi,
  invalidateConvexAuthForSignOut,
  rebindConvexAuthForWatchHandoff,
  waitForConvexAuthForUser,
} from '@/services/convex-client';
import {
  assertAccountStillCurrent,
  isAccountStillCurrent,
  settleAccountOperation,
} from '@/services/account-operation';
import type { Id } from '../../convex/_generated/dataModel';
import { destroySubscriptionWatch, initSubscriptionWatch } from '@/services/billing';
import {
  onSignIn as cloudPrefsSignIn,
  onSignOut as cloudPrefsSignOut,
} from '@/utils/cloud-prefs-sync';
import { SITE_VARIANT } from '@/config';
import { resumePendingCheckout } from '@/services/checkout';
import { showToast } from '@/utils';

export function useAuthLifecycle(): void {
  const ctx = useAppContextMaybe();

  useEffect(() => {
    if (!ctx) return;
    const c = ctx;
    const actions = getPublishedAppActions();
    if (!actions) return;

    let _prevUserId: string | null = null;
    let _convexWatchHandoffGeneration = 0;
    let _prevHadPremium = hasPremiumAccess();

    const firePremiumLoaders = (): void => {
      actions.enforceFreeTierLimits?.();
      // Stored dashboard-tab snapshots are clamped by their own pass at layout
      // init, which runs inside the same unresolved-tier window. Re-heal them
      // here so a tab the user hasn't visited yet is reconciled against the
      // real entitlement instead of waiting for them to switch to it.
      actions.healStoredTabSnapshots?.();
      const hadPremium = _prevHadPremium;
      const nowPremium = hasPremiumAccess();
      if (nowPremium && !hadPremium) {
        // Entitlement just resolved → fire PRO-gated initial loads that were
        // skipped at boot. Each loader early-returns if the panel isn't
        // mounted and re-checks hasPremiumAccess() internally, so these
        // calls are safe and idempotent. Without this, panels would sit empty
        // until the next scheduled refresh (10+ min for trade-policy; FOREVER
        // on the full variant for stock-analysis / stock-backtest / daily-
        // market-brief / market-implications because their schedulers are
        // gated to SITE_VARIANT === 'finance'). The audit-locking regression
        // test in tests/premium-loaders-fan-out-coverage.test.mts asserts
        // every `hasPremiumAccess() && shouldLoad('X')` gate in data-loader.ts
        // has a matching call here.
        void c.dataLoader?.loadTradePolicy();
        void c.dataLoader?.loadStockAnalysis();
        void c.dataLoader?.loadStockBacktest();
        void c.dataLoader?.loadDailyMarketBrief();
        void c.dataLoader?.loadMarketImplications();
        void c.dataLoader?.loadWsbTickers();
        void c.dataLoader?.loadResilienceRanking();
        void c.dataLoader?.loadGlobalTenders();
      } else if (!nowPremium && hadPremium) {
        // Pro data must not remain visible or available from the client cache
        // after sign-out, expiry, or downgrade.
        void c.dataLoader?.clearGlobalTenders();
      }
      _prevHadPremium = nowPremium;
    };

    const unsubEntitlement = onEntitlementChange(() => firePremiumLoaders());
    const unsubFreeTier = subscribeAuthState((session) => {
      const userId = session.user?.id ?? null;
      const accountTransition = (
        (userId !== null && userId !== _prevUserId) ||
        (userId === null && _prevUserId !== null)
      );
      if (accountTransition) {
        // A cloud snapshot and its recovery version belong to the account that
        // was active when they arrived. Do not let a late Pro reconcile for a
        // different account consume that pending recovery opportunity.
        actions.clearPendingCloudRecoverySyncVersion?.();
        actions.freeTierGateResetForAuthTransition?.();
      }

      if (userId !== null && userId !== _prevUserId) {
        const handoffGeneration = ++_convexWatchHandoffGeneration;

        // Rebind Convex watches to the real Clerk userId (was bound to anon UUID at init).
        // destroyEntitlementSubscription deliberately PRESERVES the last
        // snapshot so a WebSocket reconnect doesn't flash paying users back to
        // locked. That preservation is wrong across an account change: until
        // the new user's first snapshot lands, getEntitlementState() still
        // describes the previous one. Anything reading it then attributes A's
        // plan to B — e.g. premium-denial's clientBelievesPro would read B's
        // legitimate 403 as A's entitlement desync and retry instead of
        // showing the upgrade CTA. Sign-out already resets for this reason;
        // an account switch carries the same hazard.
        void startAccountAuthHandoff({
          userId,
          isCurrent: () => (
            handoffGeneration === _convexWatchHandoffGeneration &&
            getAuthState().user?.id === userId
          ),
          effects: {
            destroyEntitlementSubscription,
            resetEntitlementState,
            destroySubscriptionWatch,
            rebindConvexAuthForWatchHandoff,
            initEntitlementSubscription,
            initSubscriptionWatch,
            cloudPrefsSignIn: (nextUserId) => cloudPrefsSignIn(nextUserId, SITE_VARIANT),
          },
        });

        // Claim any anonymous purchase made before sign-in (anon → real user migration)
        const anonId = getStoredAnonId();
        if (anonId) {
          void (async () => {
            const [client, api] = await Promise.all([getConvexClient(), getConvexApi()]);
            if (!client || !api) return;
            // Wait for ConvexClient WebSocket auth handshake to complete.
            // Without this, mutations arrive at Convex before the server
            // has the JWT → "Authentication required" errors.
            const ready = await waitForConvexAuthForUser(userId, 10_000);
            if (!ready) {
              console.warn('[billing] claimSubscription skipped — Convex auth not ready');
              return;
            }
            const claimToken = getFreshStoredAnonClaimToken() ?? undefined;
            const result = await settleAccountOperation(
              userId,
              'claiming the anonymous subscription',
              () => client.mutation(api.payments.billing.claimSubscription, {
                anonId,
                ...(claimToken ? { claimToken } : {}),
              }),
            );
            assertAccountStillCurrent(userId, 'claiming the anonymous subscription');
            const claimed = result.claimed;
            const totalClaimed = claimed.subscriptions + claimed.entitlements +
                                 claimed.customers + claimed.payments;
            if (totalClaimed > 0) {
              console.log('[billing] Claimed anon subscription on sign-in:', claimed);
            }
            // Always remove after non-throwing completion — mutation is idempotent.
            // Prevents cold Convex init + mutation on every sign-in for non-purchasers.
            clearStoredAnonIdentity();
          })().catch((err: unknown) => {
            if (!isAccountStillCurrent(userId)) return;
            console.warn('[billing] claimSubscription failed:', err);
            // Non-fatal — anon ID preserved for retry on next page load
          });
        }

        // Accept a Business Pro seat invite carried in the URL (mirror of the
        // anon-claim hook). The invite link is /settings?accept-business-invite=<id>&token=<t>.
        // Runs after sign-in so the invitee's Clerk email is available server-side.
        const businessInviteGrantId = new URLSearchParams(window.location.search).get('accept-business-invite');
        const businessInviteToken = new URLSearchParams(window.location.search).get('token');
        if (businessInviteGrantId && businessInviteToken) {
          void (async () => {
            const [client, api] = await Promise.all([getConvexClient(), getConvexApi()]);
            if (!client || !api) return;
            const ready = await waitForConvexAuthForUser(userId, 10_000);
            if (!ready) {
              console.warn('[business-seats] acceptBusinessInvite skipped — Convex auth not ready');
              return;
            }
            try {
              await settleAccountOperation(
                userId,
                'accepting the Business Pro seat invite',
                () => client.mutation(api.payments.businessSeats.acceptBusinessInvite, {
                  grantId: businessInviteGrantId as Id<'businessProGrants'>,
                  token: businessInviteToken,
                }),
              );
              assertAccountStillCurrent(userId, 'accepting the Business Pro seat invite');
              showToast('Pro seat activated');
            } catch (err) {
              if (!isAccountStillCurrent(userId)) return;
              const msg = err instanceof Error ? err.message : 'Failed to accept invite';
              if (msg.includes('INVITE_EMAIL_MISMATCH')) {
                showToast('This invite is for a different email address');
              } else if (msg.includes('INVITE_EXPIRED')) {
                showToast('This invite has expired');
              } else if (msg.includes('BUSINESS_NOT_ACTIVE')) {
                showToast('The Business plan that sent this invite is no longer active');
              } else if (msg.includes('INVITE_ALREADY_USED')) {
                showToast('This invite has already been used');
              } else {
                showToast('Could not accept invite');
              }
              console.warn('[business-seats] acceptBusinessInvite failed:', err);
            } finally {
              // Clear the invite params from the URL so a refresh does not retry.
              const url = new URL(window.location.href);
              url.searchParams.delete('accept-business-invite');
              url.searchParams.delete('token');
              window.history.replaceState({}, '', url.toString());
            }
          })();
        }
        void resumePendingCheckout({
          openAuth: () => c.authModal?.open(),
        });
      } else if (userId === null && _prevUserId !== null) {
        // Clerk's mounted UserButton signs out through the SDK directly, so
        // this observed transition is the authoritative place to invalidate
        // cached/in-flight HTTP tokens and the authenticated Convex socket.
        invalidateConvexAuthForSignOut();
        // Supersede any server-auth wait that was started for the account
        // being signed out before it gets a chance to attach user watches.
        _convexWatchHandoffGeneration++;
        destroyEntitlementSubscription();
        destroySubscriptionWatch();
        cloudPrefsSignOut();
        resetEntitlementState();
      }
      _prevUserId = userId;
      // Run after account handoff/reset so this pass cannot enforce the
      // previous user's entitlement against the new user's panels.
      firePremiumLoaders();
    });

    return () => {
      unsubFreeTier();
      unsubEntitlement();
    };
  }, [ctx]);
}
