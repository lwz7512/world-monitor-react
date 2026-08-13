import { usePanelData } from '@/hooks/usePanelData';
import { t } from '@/services/i18n';
import {
  fetchSanctionsPressure,
  type SanctionsPressureResult,
  type CountrySanctionsPressure,
  type ProgramSanctionsPressure,
  type SanctionsEntry,
} from '@/services/sanctions-pressure';
import { PanelShell } from '@/components/PanelShell';

async function fetcher(_signal: AbortSignal): Promise<SanctionsPressureResult> {
  return fetchSanctionsPressure();
}

function SummaryCard({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`sanctions-summary-card${tone ? ` sanctions-summary-card-${tone}` : ''}`}>
      <span className="sanctions-summary-label">{label}</span>
      <span className="sanctions-summary-value">{String(value)}</span>
    </div>
  );
}

function CountryRow({ country }: { country: CountrySanctionsPressure }) {
  return (
    <div className="sanctions-row">
      <div className="sanctions-row-main">
        <div className="sanctions-row-title">{country.countryName}</div>
        <div className="sanctions-row-meta">
          {country.countryCode} · {t('components.sanctionsPressure.designations', { count: country.entryCount })}
        </div>
      </div>
      <div className="sanctions-row-flags">
        {country.newEntryCount > 0 && (
          <span className="sanctions-pill sanctions-pill-new">
            {t('components.sanctionsPressure.pills.newCount', { count: country.newEntryCount })}
          </span>
        )}
        {country.vesselCount > 0 && <span className="sanctions-pill">🚢 {country.vesselCount}</span>}
        {country.aircraftCount > 0 && <span className="sanctions-pill">✈ {country.aircraftCount}</span>}
      </div>
    </div>
  );
}

function ProgramRow({ program }: { program: ProgramSanctionsPressure }) {
  return (
    <div className="sanctions-row">
      <div className="sanctions-row-main">
        <div className="sanctions-row-title">{program.program}</div>
        <div className="sanctions-row-meta">
          {t('components.sanctionsPressure.designations', { count: program.entryCount })}
        </div>
      </div>
      <div className="sanctions-row-flags">
        {program.newEntryCount > 0 && (
          <span className="sanctions-pill sanctions-pill-new">
            {t('components.sanctionsPressure.pills.newCount', { count: program.newEntryCount })}
          </span>
        )}
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: SanctionsEntry }) {
  const location = entry.countryNames[0] || entry.countryCodes[0] || t('components.sanctionsPressure.fallbacks.unattributed');
  const program = entry.programs[0] || t('components.sanctionsPressure.fallbacks.program');
  const effective = entry.effectiveAt ? entry.effectiveAt.toISOString().slice(0, 10) : t('components.sanctionsPressure.fallbacks.undated');

  return (
    <div className="sanctions-entry">
      <div className="sanctions-entry-top">
        <span className="sanctions-entry-name">{entry.name}</span>
        <span className="sanctions-pill sanctions-pill-type">{entry.entityType}</span>
        {entry.isNew && (
          <span className="sanctions-pill sanctions-pill-new">
            {t('components.sanctionsPressure.pills.new')}
          </span>
        )}
      </div>
      <div className="sanctions-entry-meta">{location} · {program} · {effective}</div>
      {entry.note && <div className="sanctions-entry-note">{entry.note}</div>}
    </div>
  );
}

export function SanctionsPressurePanelContent() {
  const { data, loading, error, refetch } = usePanelData(fetcher, { ttlMs: 30 * 60 * 1000 });

  if (loading) {
    return (
      <div className="panel-loading">
        <div className="panel-loading-radar">
          <div className="panel-radar-sweep" />
          <div className="panel-radar-dot" />
        </div>
        <div className="panel-loading-text">{t('components.sanctionsPressure.loading') ?? 'Loading…'}</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-error-state">
        <div className="panel-error-msg">{error ?? t('common.failedToLoad')}</div>
        <button className="panel-error-retry" data-panel-retry="" onClick={refetch}>
          {t('common.retry') ?? 'Retry'}
        </button>
      </div>
    );
  }

  if (data.totalCount === 0) {
    return (
      <div className="economic-empty">{t('components.sanctionsPressure.unavailable')}</div>
    );
  }

  const footer = [
    t('components.sanctionsPressure.footer.updated', { time: data.fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
    data.datasetDate ? t('components.sanctionsPressure.footer.dataset', { date: data.datasetDate.toISOString().slice(0, 10) }) : '',
    t('components.sanctionsPressure.footer.source'),
  ].filter(Boolean).join(' · ');

  return (
    <div className="sanctions-panel-content">
      <div className="sanctions-summary">
        <SummaryCard label={t('components.sanctionsPressure.summary.new')} value={data.newEntryCount} tone={data.newEntryCount > 0 ? 'highlight' : ''} />
        <SummaryCard label={t('components.sanctionsPressure.summary.vessels')} value={data.vesselCount} />
        <SummaryCard label={t('components.sanctionsPressure.summary.aircraft')} value={data.aircraftCount} />
      </div>
      <div className="sanctions-sections">
        <div className="sanctions-section">
          <div className="sanctions-section-title">{t('components.sanctionsPressure.sections.countries')}</div>
          <div className="sanctions-list">
            {data.countries.length > 0
              ? data.countries.slice(0, 8).map(c => <CountryRow key={c.countryCode} country={c} />)
              : <div className="economic-empty">{t('components.sanctionsPressure.empty.countries')}</div>
            }
          </div>
        </div>
        <div className="sanctions-section">
          <div className="sanctions-section-title">{t('components.sanctionsPressure.sections.entries')}</div>
          <div className="sanctions-list">
            {data.entries.length > 0
              ? data.entries.slice(0, 10).map((e, i) => <EntryRow key={e.name || i} entry={e} />)
              : <div className="economic-empty">{t('components.sanctionsPressure.empty.entries')}</div>
            }
          </div>
        </div>
        <div className="sanctions-section">
          <div className="sanctions-section-title">{t('components.sanctionsPressure.sections.programs')}</div>
          <div className="sanctions-list">
            {data.programs.length > 0
              ? data.programs.slice(0, 6).map(p => <ProgramRow key={p.program} program={p} />)
              : <div className="economic-empty">{t('components.sanctionsPressure.empty.programs')}</div>
            }
          </div>
        </div>
      </div>
      <div className="economic-footer">{footer}</div>
    </div>
  );
}

export function SanctionsPressurePanel() {
  return (
    <PanelShell
      id="sanctions-pressure"
      title={t('components.sanctionsPressure.title')}
      showCount
      infoTooltip={t('components.sanctionsPressure.infoTooltip')}
      defaultRowSpan={2}
    >
      <SanctionsPressurePanelContent />
    </PanelShell>
  );
}
