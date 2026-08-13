import { useState, useRef, useCallback, useEffect } from 'react';
import { PanelShell } from '@/components/PanelShell';
import { t } from '@/services/i18n';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { postProcessAnalystHtml } from '@/utils/analyst-markdown';
import { yieldToMain } from '@/utils/after-paint';
import { premiumFetch } from '@/services/premium-fetch';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { readClientEntitlementBelief } from '@/services/panel-gating';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { openSignIn } from '@/services/clerk';
import { analystDenialMessage, isBillingVerificationDenial, PRO_VERIFICATION_RETRY_MESSAGE } from '@/services/analyst-denial';
import { classifyDenialResponse, type ClientEntitlementBelief } from '@/services/premium-denial';
import { reportEntitlementDesync } from '@/services/entitlement-desync-telemetry';
import { trackAnalystControlAction } from '@/services/analytics';
import {
  isDashboardControlAction,
  parseAgentBusAction,
  type AgentBusAction,
  type DashboardControlAction,
} from '../../../shared/agent-bus-actions';

const API_URL = '/api/chat-analyst';
const MAX_HISTORY = 20;
const DASHBOARD_CONTROL_STORAGE_KEY = 'wm-analyst-dashboard-control-enabled';

interface QuickAction {
  label: string;
  icon: string;
  query: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Situation',  icon: '🌍', query: "Summarize today's geopolitical situation" },
  { label: 'Markets',    icon: '📈', query: 'Key market moves, macro signals, and commodity moves today' },
  { label: 'Conflicts',  icon: '⚔️',  query: 'Top active conflicts and military developments' },
  { label: 'Forecasts',  icon: '🔮', query: 'Active forecasts and prediction market outlook' },
  { label: 'Risk',       icon: '⚠️',  query: 'Highest risk countries and instability hotspots' },
];

const DOMAINS = [
  { id: 'all', label: 'All' },
  { id: 'geo', label: 'Geo' },
  { id: 'market', label: 'Market' },
  { id: 'military', label: 'Military' },
  { id: 'economic', label: 'Economic' },
];

interface MetaEvent {
  sources: string[];
  degraded: boolean;
}

type DashboardControlStatus = 'applied' | 'denied' | 'invalid' | 'skipped';

interface DashboardControlResult {
  ok: boolean;
  status: DashboardControlStatus;
  actionType?: DashboardControlAction['type'];
  label?: string;
  reason?: string;
  message: string;
  targets: Array<{ target: string; status: DashboardControlStatus; reason?: string }>;
}

type DashboardActionHandler = (action: DashboardControlAction) => DashboardControlResult;

type ActionChip =
  | { kind: 'suggest-widget'; label: string; prefill: string }
  | { kind: 'control'; result: DashboardControlResult; action?: AgentBusAction };

interface MsgEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming: boolean;
  error: boolean;
  sources: string[];
  degraded: boolean;
  actionChips: ActionChip[];
}

const ANALYST_PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p', 'strong', 'em', 'b', 'i', 'br', 'hr',
    'ul', 'ol', 'li', 'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'div', 'span'],
  ALLOWED_ATTR: ['class'],
  ALLOW_DATA_ATTR: false,
};

function renderMarkdown(raw: string): string {
  const sanitized = DOMPurify.sanitize(marked.parse(raw) as string, ANALYST_PURIFY_CONFIG);
  return postProcessAnalystHtml(sanitized as string);
}

function loadDashboardControlEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(DASHBOARD_CONTROL_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveDashboardControlEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(DASHBOARD_CONTROL_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch { /* storage unavailable */ }
}

async function describeDenial(
  res: Response,
  requestBelief: ClientEntitlementBelief,
  requestUserId: string | null,
): Promise<string> {
  const requestIdentityChanged = () => (getAuthState().user?.id ?? null) !== requestUserId;
  if (requestIdentityChanged()) throw new DOMException('account changed during analyst request', 'AbortError');
  if (isBillingVerificationDenial(res.status, res.headers.get('X-Billing-Verification'))) {
    return PRO_VERIFICATION_RETRY_MESSAGE;
  }
  const verdict = await classifyDenialResponse(res, requestBelief);
  if (requestIdentityChanged()) throw new DOMException('account changed while reading analyst denial', 'AbortError');
  if (verdict === 'entitlement_desync') reportEntitlementDesync('chat-analyst');
  return analystDenialMessage(res.status, verdict);
}

// Module-level handler — wired by panel-layout.ts after lazy load
let _dashboardActionHandler: DashboardActionHandler | null = null;

export function setDashboardActionHandler(handler: DashboardActionHandler): void {
  _dashboardActionHandler = handler;
}

let _msgIdCounter = 0;
function nextId(): string {
  return `msg-${++_msgIdCounter}`;
}

const WELCOME_MSG: MsgEntry = {
  id: 'welcome',
  role: 'assistant',
  content: 'Ready. I have live context across geopolitical, market, military, and economic domains. Ask anything.',
  streaming: false,
  error: false,
  sources: [],
  degraded: false,
  actionChips: [],
};

// --- Sub-components ---

function FinalizedMessage({ content, error }: { content: string; error: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bodyRef.current) return;
    const el = bodyRef.current;
    void yieldToMain().then(() => {
      if (!el.isConnected) return;
      el.innerHTML = renderMarkdown(content);
    });
  }, [content]);

  return <div className={`chat-msg-body${error ? ' chat-msg-error' : ''}`} ref={bodyRef} />;
}

function StreamingBubble({ bodyRefCallback }: { bodyRefCallback: (el: HTMLDivElement | null) => void }) {
  return (
    <div className="chat-msg-body" ref={bodyRefCallback}>
      <span className="chat-streaming-dot" />
    </div>
  );
}

function ActionChips({
  chips,
  onWidgetCreator,
}: {
  chips: ActionChip[];
  onWidgetCreator: (prefill: string) => void;
}) {
  return (
    <>
      {chips.map((chip, i) => {
        if (chip.kind === 'suggest-widget') {
          return (
            <button
              key={i}
              className="chat-action-chip"
              onClick={() => onWidgetCreator(chip.prefill)}
            >
              {chip.label} →
            </button>
          );
        }
        const { result, action } = chip;
        const label = result.ok
          ? `Applied: ${result.label ?? action?.type ?? 'dashboard action'}`
          : `${result.label ?? action?.type ?? 'Dashboard action'} not applied`;
        return (
          <span
            key={i}
            className={`chat-action-chip chat-action-chip--control chat-action-chip--${result.ok ? 'applied' : result.status}`}
            title={result.message}
          >
            {label}
          </span>
        );
      })}
    </>
  );
}

function MessageBubble({
  msg,
  streamingBodyRefCallback,
  onWidgetCreator,
}: {
  msg: MsgEntry;
  streamingBodyRefCallback?: (el: HTMLDivElement | null) => void;
  onWidgetCreator: (prefill: string) => void;
}) {
  const label = msg.role === 'user' ? 'YOU' : 'ANALYST';
  return (
    <div className={`chat-msg chat-msg-${msg.role}${msg.streaming ? ' chat-msg-streaming' : ''}`}>
      <div className="chat-msg-label">{label}</div>
      {msg.actionChips.length > 0 && (
        <ActionChips chips={msg.actionChips} onWidgetCreator={onWidgetCreator} />
      )}
      {(msg.sources.length > 0 || msg.degraded) && (
        <div className="chat-source-chips">
          {msg.sources.map((src) => (
            <span key={src} className="chat-source-chip">{src}</span>
          ))}
          {msg.degraded && <span className="chat-source-chip chat-source-chip--warn">⚠ partial</span>}
        </div>
      )}
      {msg.role === 'user' ? (
        <div className="chat-msg-body">{msg.content}</div>
      ) : msg.streaming && streamingBodyRefCallback ? (
        <StreamingBubble bodyRefCallback={streamingBodyRefCallback} />
      ) : (
        <FinalizedMessage content={msg.content} error={msg.error} />
      )}
    </div>
  );
}

// --- Main content component ---

function ChatAnalystContent() {
  const [messages, setMessages] = useState<MsgEntry[]>([WELCOME_MSG]);
  const [domainFocus, setDomainFocus] = useState('all');
  const [isStreaming, setIsStreaming] = useState(false);
  const [dashboardControlEnabled, setDashboardControlEnabled] = useState(loadDashboardControlEnabled);
  const [dashboardControlPaused, setDashboardControlPaused] = useState(false);

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingBodyRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
  }, []);

  const handleSetDashboardControlEnabled = useCallback((enabled: boolean) => {
    setDashboardControlEnabled(enabled);
    if (!enabled) setDashboardControlPaused(false);
    saveDashboardControlEnabled(enabled);
  }, []);

  const handleWidgetCreator = useCallback((prefill: string) => {
    containerRef.current?.dispatchEvent(new CustomEvent('wm:open-widget-creator', {
      bubbles: true,
      detail: { initialMessage: prefill },
    }));
  }, []);

  const handleDashboardControlAction = useCallback(
    (action: DashboardControlAction): DashboardControlResult => {
      if (!dashboardControlEnabled) {
        return { ok: false, status: 'skipped', actionType: action.type, label: action.label, reason: 'control_disabled', message: 'Dashboard control is off.', targets: [] };
      }
      if (dashboardControlPaused) {
        return { ok: false, status: 'skipped', actionType: action.type, label: action.label, reason: 'control_paused', message: 'Dashboard control is paused.', targets: [] };
      }
      if (!_dashboardActionHandler) {
        return { ok: false, status: 'skipped', actionType: action.type, label: action.label, reason: 'context_unavailable', message: 'Dashboard context is unavailable.', targets: [] };
      }
      return _dashboardActionHandler(action);
    },
    [dashboardControlEnabled, dashboardControlPaused],
  );

  const send = useCallback(async (query: string) => {
    if (isStreaming) return;
    const trimmedQuery = query.trim().slice(0, 500);
    if (!trimmedQuery) return;

    setIsStreaming(true);

    const userMsgId = nextId();
    const assistantMsgId = nextId();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: trimmedQuery, streaming: false, error: false, sources: [], degraded: false, actionChips: [] },
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true, error: false, sources: [], degraded: false, actionChips: [] },
    ]);

    scrollToBottom();

    // Capture history before adding new messages (mirrors original trimmedHistory)
    const historyForRequest = messages
      .filter((m) => !m.streaming && m.id !== 'welcome')
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));

    const controller = new AbortController();
    streamAbortRef.current = controller;
    const requestAuthState = getAuthState();
    const requestUserId = requestAuthState.user?.id ?? null;
    const requestBelief = readClientEntitlementBelief(requestAuthState);

    let accumulatedText = '';

    const finalizeMsg = (text: string, success: boolean) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: text, streaming: false, error: !success }
            : m,
        ),
      );
      scrollToBottom();
    };

    const addActionChip = (chip: ActionChip) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, actionChips: [...m.actionChips, chip] }
            : m,
        ),
      );
    };

    const addMeta = (meta: MetaEvent) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, sources: meta.sources, degraded: meta.degraded }
            : m,
        ),
      );
    };

    try {
      const res = await premiumFetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historyForRequest,
          query: trimmedQuery,
          domainFocus,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        finalizeMsg(`⚠ ${await describeDenial(res, requestBelief, requestUserId)}`, false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        finalizeMsg('⚠ Stream unavailable.', false);
        return;
      }

      // Read stream — direct DOM append for streaming tokens (same as original)
      const decoder = new TextDecoder();
      let buf = '';
      let streamResult: 'done' | 'error' | 'incomplete' = 'incomplete';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as {
              delta?: string;
              done?: boolean;
              error?: string;
              meta?: MetaEvent;
              action?: unknown;
            };
            if (payload.error) {
              finalizeMsg('⚠ Analyst unavailable. Try again shortly.', false);
              streamResult = 'error';
              break outer;
            }
            if (payload.meta) addMeta(payload.meta);
            if (payload.action) {
              const parsed = parseAgentBusAction(payload.action);
              if (!parsed.ok) {
                addActionChip({ kind: 'control', result: { ok: false, status: 'invalid', reason: 'invalid_action', message: 'Analyst sent an invalid dashboard action.', targets: [] } });
              } else if (isDashboardControlAction(parsed.action)) {
                  const result = handleDashboardControlAction(parsed.action);
                if (result.actionType) trackAnalystControlAction(result.actionType, result.status, result.reason);
                addActionChip({ kind: 'control', result, action: parsed.action });
              } else if (parsed.action.type === 'suggest-widget') {
                addActionChip({ kind: 'suggest-widget', label: parsed.action.label, prefill: parsed.action.prefill });
              }
            }
            if (payload.delta) {
              accumulatedText += payload.delta;
              if (streamingBodyRef.current) {
                streamingBodyRef.current.appendChild(document.createTextNode(payload.delta));
                scrollToBottom();
              }
            }
            if (payload.done) { streamResult = 'done'; break outer; }
          } catch { /* malformed SSE chunk */ }
        }
      }

      if (streamResult === 'error') return;
      if (streamResult === 'done') {
        finalizeMsg(accumulatedText, true);
        // Push to history snapshot after success (state update async — we push directly)
        return;
      }
      // Truncated
      if (accumulatedText) {
        finalizeMsg(`${accumulatedText}\n\n⚠ *Response may be incomplete.*`, false);
      } else {
        finalizeMsg('⚠ Response cut off. Try again.', false);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        if (accumulatedText) {
          finalizeMsg(`${accumulatedText}\n\n*Response cut off.*`, true);
        } else {
          finalizeMsg('⚠ Request cancelled.', false);
        }
      } else {
        finalizeMsg('⚠ Network error. Try again.', false);
      }
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
        setIsStreaming(false);
      }
    }
  }, [isStreaming, domainFocus, messages, scrollToBottom, handleDashboardControlAction]);

  const sendFromInput = useCallback(() => {
    if (!inputRef.current || isStreaming) return;
    const query = inputRef.current.value.trim();
    if (!query) return;
    inputRef.current.value = '';
    void send(query);
  }, [isStreaming, send]);

  const clear = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsStreaming(false);
    setMessages([WELCOME_MSG]);
  }, []);

  const exportChat = useCallback(() => {
    const history = messages.filter((m) => m.id !== 'welcome' && !m.streaming);
    if (history.length === 0) return;
    const lines = [`# WM Analyst Session\n*Exported: ${new Date().toISOString()}*\n`];
    for (const msg of history) {
      const role = msg.role === 'user' ? '**You**' : '**Analyst**';
      lines.push(`\n${role}:\n${msg.content}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wm-analyst-session-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  // Stream scrolling
  useEffect(() => {
    if (isStreaming) scrollToBottom();
  }, [isStreaming, scrollToBottom]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { streamAbortRef.current?.abort(); };
  }, []);

  const streamingMsgId = messages.find((m) => m.streaming)?.id;

  const streamingBodyRefCallback = useCallback((el: HTMLDivElement | null) => {
    streamingBodyRef.current = el;
  }, []);

  return (
    <div className="chat-analyst-wrapper" ref={containerRef}>
      {/* Domain filter chips */}
      <div className="chat-analyst-chips">
        {DOMAINS.map((d) => (
          <button
            key={d.id}
            className={`chat-chip${domainFocus === d.id ? ' active' : ''}`}
            onClick={() => setDomainFocus(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Dashboard control bar */}
      <div className="chat-analyst-control-bar">
        <label className="chat-control-toggle-label">
          <input
            type="checkbox"
            className="chat-control-toggle"
            checked={dashboardControlEnabled}
            onChange={(e) => handleSetDashboardControlEnabled(e.target.checked)}
          />
          Control dashboard
        </label>
        <span
          className="chat-control-status"
          data-state={dashboardControlEnabled ? (dashboardControlPaused ? 'paused' : 'active') : 'off'}
        >
          {dashboardControlEnabled ? (dashboardControlPaused ? 'Paused' : 'Active') : 'Off'}
        </span>
        <button
          type="button"
          className="chat-control-pause"
          disabled={!dashboardControlEnabled}
          onClick={() => dashboardControlEnabled && setDashboardControlPaused((p) => !p)}
        >
          {dashboardControlPaused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {/* Messages */}
      <div className="chat-analyst-messages" ref={messagesRef}>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            streamingBodyRefCallback={msg.id === streamingMsgId ? streamingBodyRefCallback : undefined}
            onWidgetCreator={handleWidgetCreator}
          />
        ))}
      </div>

      {/* Quick actions */}
      <div className="chat-analyst-quick">
        {QUICK_ACTIONS.map((qa) => (
          <button
            key={qa.label}
            className="chat-quick-btn"
            onClick={() => void send(qa.query)}
          >
            {qa.icon} {qa.label}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div className="chat-analyst-input-row">
        <textarea
          ref={inputRef}
          className="chat-analyst-input"
          placeholder="Ask the analyst..."
          rows={2}
          disabled={isStreaming}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFromInput(); }
          }}
        />
        <button className="chat-analyst-clear" onClick={clear}>✕</button>
        <button className="chat-analyst-export" onClick={exportChat}>↓</button>
        <button className="chat-analyst-send" disabled={isStreaming} onClick={sendFromInput}>▶</button>
      </div>
    </div>
  );
}

function usePremiumGate() {
  const [authState, setAuthState] = useState(getAuthState);
  useEffect(() => subscribeAuthState(setAuthState), []);
  let reason = getPanelGateReason(authState, true);
  if (reason === PanelGateReason.FREE_TIER) reason = resolveBillingAwareGateReason(reason);
  return {
    locked: reason !== PanelGateReason.NONE,
    onLockedCtaClick: () => resolveGateAction(reason, { openAuthModal: openSignIn })(),
  };
}

export function ChatAnalystPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="chat-analyst"
      title="WM Analyst"
      defaultRowSpan={2}
      infoTooltip={t('components.chatAnalyst.infoTooltip')}
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
    >
      <ChatAnalystContent />
    </PanelShell>
  );
}
