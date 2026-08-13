import { useState, useEffect } from 'react';
import {
  RUNTIME_FEATURES,
  getRuntimeConfigSnapshot,
  isFeatureAvailable,
  subscribeRuntimeConfig,
} from '@/services/runtime-config';
import { invokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';
import { t } from '@/services/i18n';
import { PanelShell } from '@/components/PanelShell';

function openEarlyAccess() {
  const url = 'https://www.worldmonitor.app/pro';
  if (isDesktopRuntime()) {
    void invokeTauri<void>('open_url', { url }).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function RuntimeConfigPanelContent() {
  const [snapshot, setSnapshot] = useState(getRuntimeConfigSnapshot);

  useEffect(() => subscribeRuntimeConfig(() => setSnapshot(getRuntimeConfigSnapshot())), []);

  const totalFeatures = RUNTIME_FEATURES.length;
  const availableFeatures = RUNTIME_FEATURES.filter(f => isFeatureAvailable(f.id)).length;
  const missingFeatures = Math.max(0, totalFeatures - availableFeatures);
  const configuredCount = Object.keys(snapshot.secrets).length;

  if (missingFeatures === 0 && configuredCount >= totalFeatures) {
    return null;
  }

  const alertState = configuredCount > 0
    ? (missingFeatures > 0 ? 'some' : 'configured')
    : 'needsKeys';
  const alertTitle = t(`modals.runtimeConfig.alertTitle.${alertState}`);
  const alertClass = missingFeatures > 0 ? 'warn' : 'ok';

  return (
    <section className={`runtime-alert runtime-alert-${alertClass}`} data-alert-state={alertState}>
      <h3>{alertTitle}</h3>
      <p>
        {availableFeatures}/{totalFeatures} {t('modals.runtimeConfig.summary.available')}
        {configuredCount > 0 ? ` · ${configuredCount} ${t('modals.runtimeConfig.summary.secrets')}` : ''}.
      </p>
      <p className="runtime-alert-skip">{t('modals.runtimeConfig.skipSetup')}</p>
      <button type="button" className="runtime-early-access-btn" onClick={openEarlyAccess}>
        {t('modals.runtimeConfig.reserveEarlyAccess')}
      </button>
    </section>
  );
}

export function RuntimeConfigPanel() {
  return (
    <PanelShell
      id="runtime-config"
      title={t('modals.runtimeConfig.title')}
    >
      <RuntimeConfigPanelContent />
    </PanelShell>
  );
}
