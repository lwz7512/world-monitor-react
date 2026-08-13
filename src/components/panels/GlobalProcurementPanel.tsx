import { useState, useEffect, useRef } from 'react';
import { getPanelGateReason, PanelGateReason, resolveBillingAwareGateReason, resolveGateAction } from '@/services/panel-gating';
import { getAuthState, subscribeAuthState } from '@/services/auth-state';
import { openSignIn } from '@/services/clerk';
import { PanelShell } from '@/components/PanelShell';
import type { GlobalTenderFilters } from '@/services/global-tenders';
import { sanitizeUrl } from '@/utils/sanitize';
import {
  globalProcurementDataChannel,
  globalProcurementLoadingChannel,
  globalProcurementErrorChannel,
  globalProcurementRequest,
  type GlobalTender,
} from '@/services/global-procurement-store';

const DEFAULT_FILTERS: GlobalTenderFilters = {
  query: '',
  buyer: '',
  country: '',
  source: '',
  sort: 'closing_soon',
  pageSize: 25,
  cursor: '',
  minAutomationScore: 0,
};

const TECH_RELEVANCE_MIN_SCORE = 30;

const SOURCES = [
  ['', 'All sources'],
  ['sam', 'SAM.gov'],
  ['ted', 'TED'],
  ['contracts-finder', 'Contracts Finder'],
  ['canada-buys', 'CanadaBuys'],
  ['gets', 'GETS'],
  ['world-bank', 'World Bank'],
] as const;

const SORTS = [
  ['closing_soon', 'Closing soon'],
  ['newest', 'Newest'],
  ['estimated_value', 'Estimated value'],
  ['relevance', 'Technology relevance'],
] as const;

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function TenderCard({ tender }: { tender: GlobalTender }) {
  const safeUrl = sanitizeUrl(tender.officialUrl);
  const deadline = validDate(tender.deadline);
  const daysUntil = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86_400_000) : null;
  const closingSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 3;
  const amount = tender.money?.amount && tender.money.amount > 0
    ? `${tender.money.currency || ''} ${tender.money.amount.toLocaleString()}`.trim()
    : '';
  const metaParts = [
    tender.source,
    tender.buyer,
    tender.countryCode,
    amount,
    deadline ? `Closes ${deadline.toLocaleDateString()}` : '',
    closingSoon ? 'CLOSING SOON' : '',
  ].filter(Boolean);
  const matchReasons = tender.automationFit?.matchReasons ?? [];
  return (
    <article className="spending-award global-procurement-card">
      <div className="award-header">
        <span className="award-amount">{tender.status.toUpperCase()}</span>
        <span className="award-icon">{closingSoon ? '⏰' : '📄'}</span>
      </div>
      <div className="award-recipient">{tender.title}</div>
      <div className="award-agency">{metaParts.join(' · ')}</div>
      {tender.description && (
        <div className="award-desc">
          {tender.description.slice(0, 240)}{tender.description.length > 240 ? '…' : ''}
        </div>
      )}
      {matchReasons.length > 0 && (
        <div className="award-agency">
          Technology relevance (keyword evidence, not bidding eligibility): {matchReasons.join(', ')}
        </div>
      )}
      {safeUrl && (
        <a href={safeUrl} target="_blank" rel="noopener noreferrer nofollow" className="award-agency">
          Official notice ↗
        </a>
      )}
    </article>
  );
}

export function GlobalProcurementPanelContent() {
  const [data, setData] = useState(globalProcurementDataChannel.get);
  const [loading, setLoading] = useState(globalProcurementLoadingChannel.get);
  const [error, setError] = useState(globalProcurementErrorChannel.get);
  const lastFiltersRef = useRef<GlobalTenderFilters>({ ...DEFAULT_FILTERS });

  const [form, setForm] = useState({
    query: '',
    buyer: '',
    country: '',
    source: '',
    sort: 'closing_soon',
    techRelevant: false,
  });

  useEffect(() => globalProcurementDataChannel.subscribe(setData), []);
  useEffect(() => globalProcurementLoadingChannel.subscribe(setLoading), []);
  useEffect(() => globalProcurementErrorChannel.subscribe(setError), []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const filters: GlobalTenderFilters = {
      query: form.query.trim(),
      buyer: form.buyer.trim(),
      country: form.country.trim().toUpperCase().slice(0, 2),
      source: form.source,
      sort: form.sort,
      pageSize: 25,
      cursor: '',
      minAutomationScore: form.techRelevant ? TECH_RELEVANCE_MIN_SCORE : 0,
    };
    lastFiltersRef.current = { ...filters };
    globalProcurementRequest(filters, false);
  };

  const handleReset = () => {
    setForm({ query: '', buyer: '', country: '', source: '', sort: 'closing_soon', techRelevant: false });
    lastFiltersRef.current = { ...DEFAULT_FILTERS };
    globalProcurementRequest({ ...DEFAULT_FILTERS }, false);
  };

  const handleLoadMore = () => {
    const cursor = data?.nextCursor;
    if (cursor && !loading) {
      globalProcurementRequest({ ...lastFiltersRef.current, cursor }, true);
    }
  };

  if (!data && !error && loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar"><div className="panel-radar-sweep" /><div className="panel-radar-dot" /></div>
        <div className="panel-loading-text">Loading procurement opportunities…</div>
      </div>
    );
  }

  const availability = data?.availability;

  return (
    <div className="global-procurement-content">
      <form className="global-procurement-controls" onSubmit={handleSubmit}>
        <input
          className="global-procurement-input"
          name="query"
          type="search"
          value={form.query}
          onChange={e => setForm(f => ({ ...f, query: e.target.value }))}
          placeholder="Search title or description"
          aria-label="Search procurement opportunities"
        />
        <input
          className="global-procurement-input"
          name="buyer"
          type="search"
          value={form.buyer}
          onChange={e => setForm(f => ({ ...f, buyer: e.target.value }))}
          placeholder="Buyer"
          aria-label="Filter by buyer"
        />
        <input
          className="global-procurement-input global-procurement-country"
          name="country"
          type="text"
          maxLength={2}
          value={form.country}
          onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
          placeholder="Country"
          aria-label="Filter by ISO country code"
        />
        <select
          className="global-procurement-select"
          name="source"
          value={form.source}
          onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
          aria-label="Filter by source"
        >
          {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          className="global-procurement-select"
          name="sort"
          value={form.sort}
          onChange={e => setForm(f => ({ ...f, sort: e.target.value }))}
          aria-label="Sort opportunities"
        >
          {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label
          className="global-procurement-toggle"
          title="Shows only opportunities whose title, description, or categories matched technology keywords."
        >
          <input
            type="checkbox"
            name="techRelevant"
            checked={form.techRelevant}
            onChange={e => setForm(f => ({ ...f, techRelevant: e.target.checked }))}
            disabled={loading}
          />
          Technology relevant only
        </label>
        <button type="submit" className="global-procurement-apply" disabled={loading}>Apply</button>
        <button type="button" className="global-procurement-reset" onClick={handleReset} disabled={loading}>Reset</button>
      </form>

      {error && <div className="economic-warning">{error}</div>}

      {availability === 'partial' && (
        <div className="economic-warning">Partial coverage — healthy sources remain visible while one or more sources are unavailable.</div>
      )}
      {availability === 'stale' && (
        <div className="economic-warning">Showing stale last-good opportunities while all source refreshes are failing.</div>
      )}
      {availability === 'empty' && (
        <div className="economic-empty">Official sources returned no matching open opportunities.</div>
      )}
      {data && !data.dataAvailable && !['partial', 'stale', 'empty'].includes(data.availability) && (
        <div className="economic-warning">The canonical procurement snapshot is unavailable.</div>
      )}

      {data && (
        <>
          <div className="global-procurement-summary">
            Showing {data.tenders.length.toLocaleString()} of {data.total.toLocaleString()} matching opportunities
          </div>
          {data.tenders.length > 0 && (
            <div className="spending-list global-procurement-list">
              {data.tenders.map(t => <TenderCard key={t.id} tender={t} />)}
            </div>
          )}
          {data.nextCursor && (
            <button
              type="button"
              className="debt-load-more"
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Load more'}{' '}
              <span className="debt-load-more-count">({Math.max(0, data.total - data.tenders.length)} remaining)</span>
            </button>
          )}
          <div className="economic-footer">
            <span className="economic-source">
              {data.sourceStatuses.map(s => {
                const lastSuccess = s.lastSuccessfulAt ? ` · last success ${new Date(s.lastSuccessfulAt).toLocaleString()}` : '';
                return `${s.source}: ${s.state} (${s.recordCount})${lastSuccess}`;
              }).join(' · ')}
              {data.fetchedAt ? ` · snapshot ${new Date(data.fetchedAt).toLocaleString()}` : ''}
            </span>
          </div>
        </>
      )}

      {!data && !error && !loading && (
        <div className="economic-empty">No procurement snapshot is available yet.</div>
      )}
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

export function GlobalProcurementPanel() {
  const { locked, onLockedCtaClick } = usePremiumGate();
  const [data, setData] = useState(globalProcurementDataChannel.get);
  useEffect(() => globalProcurementDataChannel.subscribe(setData), []);
  const count = data?.tenders.length ?? null;
  return (
    <PanelShell
      id="global-procurement"
      title="Global Procurement"
      defaultRowSpan={2}
      showCount
      count={count}
      infoTooltip="Search active official procurement opportunities. Results are seed-backed and source health is reported explicitly."
      locked={locked}
      onLockedCtaClick={onLockedCtaClick}
    >
      <GlobalProcurementPanelContent />
    </PanelShell>
  );
}
