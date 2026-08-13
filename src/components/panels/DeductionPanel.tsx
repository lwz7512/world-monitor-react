import { useState, useEffect, useRef } from 'react';
import type { DeductContextDetail } from '@/types';
import { createLazyClient, getRpcBaseUrl } from '@/services/rpc-client';
import { premiumFetch } from '@/services/premium-fetch';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { extractDeductionProbability } from '@/components/deduction-probability';
import { getActiveFrameworkForPanel } from '@/services/analysis-framework-store';
import { IntelligenceServiceClient } from '@/services/generated-rpc-clients';
import { yieldToMain } from '@/utils/after-paint';
import { PanelShell } from '@/components/PanelShell';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';

const getIntelligenceClient = createLazyClient(
  () => new IntelligenceServiceClient(getRpcBaseUrl(), { fetch: premiumFetch }),
);

const COOLDOWN_MS = 5_000;

// Mirrors DeductionPanel.reformatResult — restructures DOMPurify-sanitized
// markdown output into visually styled sections (verdict, evidence, paths, confidence).
function reformatResult(container: HTMLElement): void {
  const SECTIONS = [
    { re: /^bottom\s+line/i,        cls: 'ds-verdict',    label: 'Bottom Line' },
    { re: /^what\s+we\s+know/i,     cls: 'ds-evidence',   label: 'What We Know' },
    { re: /^most\s+likely\s+path/i, cls: 'ds-primary',    label: 'Most Likely Path' },
    { re: /^alternative\s+path/i,   cls: 'ds-alt',        label: 'Alternative Paths' },
    { re: /^confidence/i,           cls: 'ds-confidence', label: 'Confidence' },
  ] as const;

  const nodes = Array.from(container.childNodes) as HTMLElement[];
  const groups: { cls: string; label: string; nodes: HTMLElement[] }[] = [];
  let current: { cls: string; label: string; nodes: HTMLElement[] } | null = null;

  for (const node of nodes) {
    const strongText = (node.querySelector?.('strong')?.textContent ?? node.textContent ?? '').trim();
    const match = SECTIONS.find(s => s.re.test(strongText));
    if (match) { current = { cls: match.cls, label: match.label, nodes: [] }; groups.push(current); }
    if (current) current.nodes.push(node);
    else if (!match) groups.push({ cls: '', label: '', nodes: [node] });
  }

  if (groups.every(g => !g.cls)) return;

  container.replaceChildren();
  for (const group of groups) {
    if (!group.cls) { group.nodes.forEach(n => container.appendChild(n)); continue; }

    const section = document.createElement('div');
    section.className = group.cls;

    const labelEl = document.createElement('div');
    labelEl.className = 'ds-section-label';

    if (group.cls === 'ds-primary') {
      const fullText = group.nodes[0]?.textContent ?? '';
      const probability = extractDeductionProbability(fullText);
      const timeMatch = /\(([^)]+)\)/.exec(fullText);
      labelEl.textContent = group.label;
      if (timeMatch) {
        const timeSpan = document.createElement('span');
        timeSpan.style.cssText = 'font-size:10px;color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0';
        timeSpan.textContent = timeMatch[1] ?? '';
        labelEl.appendChild(timeSpan);
      }
      if (probability) {
        const badge = document.createElement('span');
        badge.className = 'ds-prob-badge';
        badge.textContent = probability.label;
        badge.title = probability.isRange ? 'Rough probability range from the source' : 'Approximate probability from the source';
        labelEl.appendChild(badge);
      }
    } else {
      labelEl.textContent = group.label;
    }
    section.appendChild(labelEl);

    const bodyNodes = group.nodes.slice(1);
    if (bodyNodes.length === 0 && group.nodes[0]) {
      const clone = group.nodes[0].cloneNode(true) as HTMLElement;
      clone.querySelector('strong')?.remove();
      const bodyDiv = document.createElement('div');
      bodyDiv.className = group.cls === 'ds-primary' ? 'ds-primary-body' : '';
      bodyDiv.innerHTML = clone.innerHTML.replace(/^[\s:–—-]+/, '');
      section.appendChild(bodyDiv);
    } else if (group.cls === 'ds-alt') {
      bodyNodes.forEach(n => {
        if ((n as HTMLElement).tagName === 'UL') {
          (n as HTMLElement).querySelectorAll('li').forEach(li => {
            const prob = extractDeductionProbability(li.textContent ?? '', { leadingOnly: true });
            if (prob) {
              const badge = document.createElement('span');
              badge.className = 'ds-alt-prob';
              badge.textContent = prob.label;
              badge.title = prob.isRange ? 'Rough probability range from the source' : 'Approximate probability from the source';
              li.textContent = prob.remainder;
              li.insertBefore(badge, li.firstChild);
            }
          });
        }
        section.appendChild(n);
      });
    } else {
      bodyNodes.forEach(n => section.appendChild(n));
    }
    container.appendChild(section);
  }
}

type SubmitState =
  | { type: 'idle' }
  | { type: 'loading' }
  | { type: 'result'; html: string }
  | { type: 'error'; message: string };

export function DeductionPanelContent() {
  const [query, setQuery] = useState('');
  const [geoCtx, setGeoCtx] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>({ type: 'idle' });
  const [btnDisabled, setBtnDisabled] = useState(false);
  const canSubmitRef = useRef(true);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  async function doSubmit(q: string, gc: string) {
    if (!q.trim() || !canSubmitRef.current) return;
    canSubmitRef.current = false;
    setBtnDisabled(true);
    setSubmitState({ type: 'loading' });
    const fw = getActiveFrameworkForPanel('deduction');
    try {
      const resp = await getIntelligenceClient().deductSituation({
        query: q.trim(),
        geoContext: gc.trim(),
        framework: fw?.systemPromptAppend ?? '',
      });
      if (!mountedRef.current) return;
      if (resp.analysis) {
        const parsed = await marked.parse(resp.analysis);
        await yieldToMain();
        if (!mountedRef.current) return;
        const safe = DOMPurify.sanitize(parsed);
        const temp = document.createElement('div');
        temp.innerHTML = safe;
        reformatResult(temp);
        setSubmitState({ type: 'result', html: temp.innerHTML });
      } else {
        setSubmitState({
          type: 'error',
          message: resp.provider === 'error'
            ? 'AI analysis temporarily unavailable. Please try again in a moment.'
            : 'No analysis available for this query.',
        });
      }
    } catch {
      if (mountedRef.current) setSubmitState({ type: 'error', message: 'An error occurred while analyzing the situation.' });
    } finally {
      setTimeout(() => { canSubmitRef.current = true; if (mountedRef.current) setBtnDisabled(false); }, COOLDOWN_MS);
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DeductContextDetail>).detail;
      if (detail.query) setQuery(detail.query);
      if (detail.geoContext) setGeoCtx(detail.geoContext);
      if (detail.autoSubmit && detail.query) void doSubmit(detail.query, detail.geoContext ?? '');
    };
    document.addEventListener('wm:deduct-context', handler);
    return () => document.removeEventListener('wm:deduct-context', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void doSubmit(query, geoCtx);
  }

  const isLoading = submitState.type === 'loading';
  const resultCls = `deduction-result${isLoading ? ' loading' : submitState.type === 'error' ? ' error' : ''}`;

  return (
    <div className="deduction-panel-content">
      <form className="deduction-form" onSubmit={handleSubmit}>
        <textarea
          className="deduction-input"
          placeholder="E.g., What will possibly happen in the next 24 hours in Middle East?"
          required
          rows={3}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <div className="deduction-form-row">
          <input
            className="deduction-geo-input"
            type="text"
            placeholder="Geographic or situation context (optional)..."
            value={geoCtx}
            onChange={e => setGeoCtx(e.target.value)}
          />
          <button className="deduction-submit-btn" type="submit" disabled={btnDisabled || isLoading}>
            Analyze
          </button>
        </div>
      </form>
      <div className={resultCls}>
        {isLoading && (
          <>
            <div className="deduction-loading-dots"><span /><span /><span /></div>
            Analyzing…
          </>
        )}
        {submitState.type === 'result' && <div dangerouslySetInnerHTML={{ __html: submitState.html }} />}
        {submitState.type === 'error' && submitState.message}
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

export function DeductionPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  return (
    <PanelShell
      id="deduction"
      title="Deduct Situation"
      infoTooltip="Use AI intelligence to deduct the timeline and impact of a hypothetical or current event."
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
    >
      <DeductionPanelContent />
    </PanelShell>
  );
}
