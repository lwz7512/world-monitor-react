import { useState, useEffect, useRef, useCallback } from 'react';
import { getClerkToken, clearClerkTokenCache } from '@/services/clerk';
import { hasPremiumAccess, readClientEntitlementBelief } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { PanelShell } from '@/components/PanelShell';
import { getEntitlementState } from '@/services/entitlements';
import {
  classifyDenialResponse,
  isTransientDenial,
  routeDenial,
  shouldSkipDoomedFetch,
  type PremiumDenialVerdict,
} from '@/services/premium-denial';
import { reportEntitlementDesync } from '@/services/entitlement-desync-telemetry';
import { trackBriefThreadOpen } from '@/services/analytics';
import type { ReferralProfile } from '@/services/referral';

interface LatestBriefReady {
  status: 'ready';
  issueDate: string;
  dateLong: string;
  greeting: string;
  threadCount: number;
  magazineUrl: string;
}

interface LatestBriefComposing {
  status: 'composing';
  issueDate: string;
}

type LatestBriefResponse = LatestBriefReady | LatestBriefComposing;

class BriefAccessError extends Error {
  readonly code: PremiumDenialVerdict;
  constructor(code: PremiumDenialVerdict) {
    super(code);
    this.code = code;
    this.name = 'BriefAccessError';
  }
}

const LATEST_BRIEF_ENDPOINT = '/api/latest-brief';
const COMPOSING_POLL_MS = 60_000;
const MAX_TRANSIENT_DENIALS = 8;

type BriefState =
  | { type: 'loading' }
  | { type: 'sign-in-required' }
  | { type: 'upgrade-required' }
  | { type: 'composing'; issueDate: string }
  | { type: 'ready'; data: LatestBriefReady }
  | { type: 'desync-exhausted' }
  | { type: 'error'; message: string };

function WmLogo() {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="32" cy="32" r="28"/>
      <ellipse cx="32" cy="32" rx="5" ry="28"/>
      <ellipse cx="32" cy="32" rx="14" ry="28"/>
      <ellipse cx="32" cy="32" rx="22" ry="28"/>
      <ellipse cx="32" cy="32" rx="28" ry="5"/>
      <ellipse cx="32" cy="32" rx="28" ry="14"/>
      <path d="M 6 32 L 20 32 L 24 24 L 30 40 L 36 22 L 42 38 L 46 32 L 56 32" strokeWidth="2.4"/>
      <circle cx="57" cy="32" r="1.8" fill="currentColor" stroke="none"/>
    </svg>
  );
}

async function fetchLatestBrief(signal: AbortSignal): Promise<LatestBriefResponse> {
  const token = await getClerkToken();
  if (!token) throw new Error('Sign in to view your brief.');
  const res = await fetch(LATEST_BRIEF_ENDPOINT, {
    signal,
    headers: { Authorization: `Bearer ${token}` },
  });
  const verdict = await classifyDenialResponse(res, readClientEntitlementBelief(getAuthState()));
  if (verdict !== null) {
    if (signal.aborted) throw new DOMException('aborted while reading denial body', 'AbortError');
    if (verdict === 'entitlement_desync') reportEntitlementDesync('latest-brief');
    throw new BriefAccessError(verdict);
  }
  if (!res.ok) throw new Error(`Brief service unavailable (${res.status})`);
  const body = (await res.json()) as LatestBriefResponse;
  if (!body || (body.status !== 'ready' && body.status !== 'composing')) {
    throw new Error('Unexpected response from brief service');
  }
  return body;
}

function ShareRow() {
  const [profile, setProfile] = useState<ReferralProfile | null | undefined>(undefined);
  const [shareStatus, setShareStatus] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const modRef = useRef<{ shareReferral: (p: ReferralProfile) => Promise<'shared' | 'copied' | 'blocked' | 'error'> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('@/services/referral');
        if (cancelled) return;
        modRef.current = mod;
        const p = await mod.getReferralProfile();
        if (!cancelled) setProfile(p ?? null);
      } catch {
        if (!cancelled) setProfile(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (profile === undefined || profile === null) return null;

  async function handleShare() {
    if (!modRef.current || !profile) return;
    setIsSharing(true);
    try {
      const result = await modRef.current.shareReferral(profile);
      setShareStatus(result === 'shared' ? 'Thanks for sharing' : result === 'copied' ? 'Link copied' : 'Share unavailable');
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <div className="latest-brief-share-row">
      <button
        type="button"
        className="latest-brief-share"
        aria-label="Share WorldMonitor — copies a referral link"
        disabled={isSharing}
        onClick={() => { void handleShare(); }}
      >Share ↗</button>
      {shareStatus && <span className="latest-brief-share-status" aria-live="polite">{shareStatus}</span>}
    </div>
  );
}

export function LatestBriefPanelContent() {
  const [state, setState] = useState<BriefState>({ type: 'loading' });
  const refreshingRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  const transientDenialsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const composingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearComposingPoll = useCallback(() => {
    if (composingTimerRef.current !== null) {
      clearTimeout(composingTimerRef.current);
      composingTimerRef.current = null;
    }
  }, []);

  const doRefresh: () => Promise<void> = useCallback(async () => {
    if (refreshingRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    clearComposingPoll();

    const authState = getAuthState();
    if (!hasPremiumAccess(authState)) return;

    const requestUserId = authState.user?.id ?? null;
    if (!requestUserId) {
      setState({ type: 'sign-in-required' });
      return;
    }

    if (shouldSkipDoomedFetch(getEntitlementState() !== null, readClientEntitlementBelief(authState))) {
      setState({ type: 'upgrade-required' });
      return;
    }

    refreshingRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await fetchLatestBrief(controller.signal);

      if (!hasPremiumAccess(getAuthState())) return;
      if ((getAuthState().user?.id ?? null) !== requestUserId) return;

      transientDenialsRef.current = 0;

      if (data.status === 'ready') {
        setState({ type: 'ready', data });
      } else {
        setState({ type: 'composing', issueDate: data.issueDate });
        composingTimerRef.current = setTimeout(() => {
          composingTimerRef.current = null;
          void doRefresh();
        }, COMPOSING_POLL_MS);
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      if (!hasPremiumAccess(getAuthState())) return;
      if ((getAuthState().user?.id ?? null) !== requestUserId) return;

      if (err instanceof BriefAccessError) {
        if (isTransientDenial(err.code)) transientDenialsRef.current += 1;
        switch (routeDenial(err.code, transientDenialsRef.current, MAX_TRANSIENT_DENIALS)) {
          case 'sign_in':
            setState({ type: 'sign-in-required' });
            return;
          case 'upgrade':
            setState({ type: 'upgrade-required' });
            return;
          case 'give_up':
            setState({ type: 'desync-exhausted' });
            return;
          default:
            setState({
              type: 'error',
              message: err.code === 'entitlement_desync'
                ? 'Verifying your Pro access — your brief will appear shortly.'
                : 'Brief service unavailable — retrying shortly.',
            });
            composingTimerRef.current = setTimeout(() => {
              composingTimerRef.current = null;
              void doRefresh();
            }, 15_000);
            return;
        }
      }
      setState({
        type: 'error',
        message: err instanceof Error ? err.message : 'Brief unavailable — try again shortly.',
      });
    } finally {
      refreshingRef.current = false;
      abortRef.current = null;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void doRefresh();
      }
    }
  }, [clearComposingPoll]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    lastUserIdRef.current = getAuthState().user?.id ?? null;
    void doRefresh();

    const unsub = subscribeAuthState((authState) => {
      const nextId = authState.user?.id ?? null;
      if (nextId === lastUserIdRef.current) return;
      lastUserIdRef.current = nextId;
      abortRef.current?.abort();
      abortRef.current = null;
      clearComposingPoll();
      transientDenialsRef.current = 0;
      clearClerkTokenCache();
      if (nextId) {
        void doRefresh();
      } else {
        setState({ type: 'sign-in-required' });
      }
    });

    return () => { unsub(); };
  }, [doRefresh, clearComposingPoll]);

  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') void doRefresh(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [doRefresh]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearComposingPoll();
    };
  }, [clearComposingPoll]);

  if (state.type === 'loading') {
    return (
      <div className="latest-brief-empty">
        <div className="latest-brief-empty-title">Loading your brief…</div>
      </div>
    );
  }

  if (state.type === 'sign-in-required') {
    return (
      <div className="latest-brief-card latest-brief-card--composing">
        <div className="latest-brief-logo"><WmLogo /></div>
        <div className="latest-brief-empty-title">Sign in to view your brief.</div>
        <div className="latest-brief-empty-body">
          Your personalised brief is tied to your WorldMonitor account. Sign in to see today's issue.
        </div>
      </div>
    );
  }

  if (state.type === 'upgrade-required') {
    return (
      <div className="latest-brief-card latest-brief-card--composing">
        <div className="latest-brief-logo"><WmLogo /></div>
        <div className="latest-brief-empty-title">Pro required.</div>
        <div className="latest-brief-empty-body">
          The WorldMonitor Brief is included with the Pro plan. Upgrade to unlock today's issue.
        </div>
      </div>
    );
  }

  if (state.type === 'desync-exhausted') {
    return (
      <div className="latest-brief-card latest-brief-card--composing">
        <div className="latest-brief-logo"><WmLogo /></div>
        <div className="latest-brief-empty-title">We couldn't confirm your plan.</div>
        <div className="latest-brief-empty-body">
          Your account looks active here, but the brief service still can't verify it.
          Reload the page — if this keeps happening, contact support and we'll sort it out.
        </div>
      </div>
    );
  }

  if (state.type === 'error') {
    return (
      <div className="latest-brief-empty">
        <div className="latest-brief-empty-title">{state.message}</div>
      </div>
    );
  }

  if (state.type === 'composing') {
    return (
      <div className="latest-brief-card latest-brief-card--composing">
        <div className="latest-brief-logo"><WmLogo /></div>
        <div className="latest-brief-empty-title">Your brief is composing.</div>
        <div className="latest-brief-empty-body">
          The editorial team at WorldMonitor is writing your {state.issueDate} brief. Check back in a moment.
        </div>
      </div>
    );
  }

  const { data } = state;
  const threadLabel = data.threadCount === 1 ? '1 thread' : `${data.threadCount} threads`;

  return (
    <>
      <a
        className="latest-brief-card latest-brief-card--ready"
        href={data.magazineUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open today's brief — ${threadLabel}`}
        onClick={() => {
          try {
            trackBriefThreadOpen({ country: null, followed: false, severity: null, source: 'dashboard' });
          } catch { /* analytics outage must not break navigation */ }
        }}
      >
        <div className="latest-brief-cover">
          <div className="latest-brief-cover-logo"><WmLogo /></div>
          <div className="latest-brief-cover-issue">{data.dateLong}</div>
          <div className="latest-brief-cover-title">WorldMonitor</div>
          <div className="latest-brief-cover-title">Brief.</div>
          <div className="latest-brief-cover-kicker">{threadLabel}</div>
        </div>
        <div className="latest-brief-meta">
          <div className="latest-brief-greeting">{data.greeting}</div>
          <div className="latest-brief-cta">Read brief →</div>
        </div>
      </a>
      <ShareRow />
    </>
  );
}

export function LatestBriefPanel() {
  return (
    <PanelShell
      id="latest-brief"
      title="Latest Brief"
      infoTooltip="Your personalised daily editorial magazine. One brief per day, assembled from the news-intelligence layer and delivered via email, Telegram, Slack, and here."
    >
      <LatestBriefPanelContent />
    </PanelShell>
  );
}
