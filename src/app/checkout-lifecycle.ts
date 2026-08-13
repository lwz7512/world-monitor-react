import { handleCheckoutReturn } from '@/services/checkout-return';
import {
  registerCheckoutSuccessCallback,
  destroyCheckoutOverlay,
  showCheckoutSuccess,
  consumePostCheckoutFlag,
  clearCheckoutAttempt,
  loadCheckoutAttempt,
} from '@/services/checkout';
import {
  markProActivationPending,
  ProActivationController,
} from '@/app/pro-activation-controller';
import { showCheckoutFailureBanner } from '@/components/checkout-failure-banner';
import {
  trackCheckoutSuccess,
  trackCheckoutFailed,
  replayPendingCheckoutSuccess,
  replayPendingProFunnelEvents,
  replayPendingConversionEvents,
} from '@/services/analytics';
import { initPaymentFailureBanner } from '@/components/payment-failure-banner';
import {
  initEntitlementSubscription,
  destroyEntitlementSubscription,
  isEntitlementActive,
  onEntitlementChange,
} from '@/services/entitlements';
import { createEntitlementReloadController } from '@/services/entitlement-reload-controller';
import {
  initSubscriptionWatch,
  destroySubscriptionWatch,
  onSubscriptionChange,
} from '@/services/billing';
import { getAuthState } from '@/services/auth-state';
import type { AppContext } from '@/app/app-context';

export interface CheckoutLifecycle {
  init(): void;
  destroy(): void;
}

export function initCheckoutAndBilling(
  ctx: AppContext,
  onGatingChanged: () => void,
  revealAnalystPanel: () => void,
  openSearch: () => void,
): CheckoutLifecycle {
  const returnResult = handleCheckoutReturn();
  const returnedFromOverlay = consumePostCheckoutFlag();
  const returnedFromCheckout = returnResult.kind === 'success' || returnedFromOverlay;

  const proActivationController = new ProActivationController(ctx, {
    reloadPending: returnedFromCheckout,
    openAiAnalyst: revealAnalystPanel,
    openSearch,
  });

  if (returnedFromCheckout) {
    // Funnel (#4931): the purchase-complete signal on the client side.
    // Queued by the analytics facade until Umami loads after first paint.
    trackCheckoutSuccess(returnResult.kind === 'success' ? 'url-return' : 'overlay-flag');
    // Pro Activation Onboarding: capture the plan identity from the attempt
    // record and write the durable pending-onboarding marker BEFORE the
    // clear below wipes the attempt. Success branch only (the `failed`
    // branch structurally cannot reach here). An overlay-only return may
    // carry no attempt record → the marker omits productId and the boot
    // hook falls back to the live entitlement snapshot for plan identity
    // (never a write-time frozen fallback — see decideActivationMount).
    const activationProductId = loadCheckoutAttempt()?.productId ?? null;
    markProActivationPending(activationProductId);
    // Full-page return cleared its URL params; belt-and-braces clear
    // of the attempt record here catches the success path where the
    // overlay handler never ran (direct Dodo redirect).
    clearCheckoutAttempt('success');
    // waitForEntitlement: true keeps the banner mounted across the
    // entitlement-watcher reload (post-PR-4 the watcher is the single
    // reload source). If the user is already entitled on mount the
    // banner goes straight to the "active" state; otherwise it waits
    // up to 30s for the transition before surfacing a manual-refresh
    // CTA. `email` is read from auth-state (authoritative on the main
    // app) and masked in the banner before rendering to keep the raw
    // address out of screenshots / screen-shares of the banner.
    showCheckoutSuccess({
      waitForEntitlement: true,
      email: getAuthState().user?.email ?? null,
    });
  } else if (returnResult.kind === 'failed') {
    trackCheckoutFailed(returnResult.rawStatus);
    showCheckoutFailureBanner(returnResult.rawStatus);
  }

  if (!returnedFromCheckout) {
    // #4934 round-2 F2: the entitlement watcher reloads the page the
    // moment Pro lands — often before the deferred Umami queue flushes,
    // which would silently drop the terminal checkout-success event.
    // This boot-time replay re-queues it from the durable marker the
    // pre-reload track left behind (no-op on ordinary loads).
    replayPendingCheckoutSuccess();
  }
  // #4934 round-5: /pro checkout-start events that died with the Dodo
  // redirect are mirrored in sessionStorage; the buyer lands back here
  // in the same tab — on BOTH the checkout-return and ordinary branches —
  // so this replay is unconditional (no-op when nothing is pending).
  replayPendingProFunnelEvents();

  // Dashboard checkout-start / checkout-failed have the same exposure: both
  // are followed by a navigation (the Dodo redirect) that outlives any
  // in-page retry, so their durable markers replay here too.
  replayPendingConversionEvents();

  // Always register the payment-failure-banner listener — onSubscriptionChange
  // is an in-memory listener registry, doesn't open any network connection,
  // and survives the destroy/reinit cycle on auth transitions.
  const unsubscribePaymentFailureBanner = initPaymentFailureBanner();

  // Defer Convex subscriptions until a real Clerk identity exists.
  // Constructor-time anon is the common case; signed-in users are picked up
  // by subscribeAuthState a few hundred ms later via the App.ts rebind path.
  if (getAuthState().user) {
    const userId = getAuthState().user!.id;
    initEntitlementSubscription(userId).catch(() => {});
    initSubscriptionWatch(userId).catch(() => {});
  }

  // Overlay success fires BEFORE the entitlement-watcher reload. The banner
  // stays mounted through the reload via waitForEntitlement so the user sees
  // visual continuity from "Payment received!" through "Premium activated".
  // Read the email lazily at fire-time (not at register-time) so a just-
  // signed-in buyer who completes checkout in the same session still sees
  // the receipt acknowledgement.
  registerCheckoutSuccessCallback(() =>
    showCheckoutSuccess({
      waitForEntitlement: true,
      email: getAuthState().user?.email ?? null,
    }),
  );

  // Reload at most once per account and browser tab on a free→pro transition.
  // REQUIRES_SKIP_INITIAL_SNAPSHOT_BEHAVIOR — this remains the sole automatic
  // reload source for post-checkout success. Regression guards:
  // tests/entitlement-transition.test.mts locks the raw transition semantics;
  // tests/entitlement-reload-controller.test.mts locks the cross-boot invariant.
  const entitlementReloadController = createEntitlementReloadController({
    returnedFromCheckout,
    onSnapshot: onGatingChanged,
    reload: () => {
      console.log('[entitlements] Subscription activated — reloading once to unlock panels');
      window.location.reload();
    },
  });

  const unsubscribeEntitlementChange = onEntitlementChange((state) => {
    entitlementReloadController.handleSnapshot(
      state === null ? null : isEntitlementActive(state, Date.now()),
      getAuthState().user?.id ?? null,
    );
  });

  // #4771: billing-state transitions can arrive on the SUBSCRIPTION row alone
  // with no entitlement snapshot change. Re-run gating so billing-aware CTA
  // copy tracks the current state.
  const unsubscribeSubscriptionChange = onSubscriptionChange(() => {
    onGatingChanged();
  });

  return {
    init() {
      proActivationController.init();
    },
    destroy() {
      unsubscribeEntitlementChange?.();
      unsubscribeSubscriptionChange?.();
      unsubscribePaymentFailureBanner?.();
      destroySubscriptionWatch();
      destroyEntitlementSubscription();
      proActivationController.destroy();
      destroyCheckoutOverlay();
    },
  };
}
