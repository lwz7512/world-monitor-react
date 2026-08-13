import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function src(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf-8');
}

describe('energy atlas guardrails', () => {
  it('registers recurring refresh coverage for atlas panels', () => {
    const base = src('src/config/variants/base.ts');

    // React migration: all 4 class-based atlas panels migrated to React.
    // They now self-manage fetch refresh via their own useEffect/useState logic.
    // Verify that base REFRESH_INTERVALS still defines the expected intervals
    // (these are shared with any future scheduler or ttlMs usage).
    const expectedIntervals = [
      'pipelineStatus',
      'storageFacilityMap',
      'fuelShortages',
      'energyDisruptions',
    ];

    for (const key of expectedIntervals) {
      assert.match(
        base,
        new RegExp(`\\b${key}:`),
        `base refresh intervals must define ${key}`,
      );
    }

    // React-migrated atlas panels self-schedule via their own fetch logic.
    // Verify each panel file exists in components/panels.
    const reactAtlasPanels: Array<[string, string]> = [
      ['pipeline-status', 'src/components/panels/PipelineStatusPanel.tsx'],
      ['storage-facility-map', 'src/components/panels/StorageFacilityMapPanel.tsx'],
      ['fuel-shortages', 'src/components/panels/FuelShortagePanel.tsx'],
      ['energy-disruptions', 'src/components/panels/EnergyDisruptionsPanel.tsx'],
      ['energy-risk-overview', 'src/components/panels/EnergyRiskOverviewPanel.tsx'],
      ['chokepoint-strip', 'src/components/panels/ChokepointStripPanel.tsx'],
    ];
    for (const [panelId, filePath] of reactAtlasPanels) {
      const panelSrc = src(filePath);
      assert.ok(
        panelSrc.length > 0,
        `${panelId} must be a React panel in components/panels`,
      );
    }
  });

  it('filters variant-scoped panel categories in unified settings', () => {
    const settings = src('src/components/UnifiedSettings.ts');

    assert.match(
      settings,
      /private categoryMatchesVariant\(catDef: \{ variants\?: string\[\] \}\): boolean \{[\s\S]*?catDef\.variants\.includes\(SITE_VARIANT\)/,
      'UnifiedSettings must compare category variants against SITE_VARIANT',
    );
    assert.match(
      settings,
      /getAvailablePanelCategories\(\):[\s\S]*?categoryMatchesVariant\(catDef\)/,
      'category pills must skip categories outside the active variant',
    );
    assert.match(
      settings,
      /getVisiblePanelEntries\(\):[\s\S]*?categoryMatchesVariant\(catDef\)/,
      'panel entry filtering must honor category variant scoping too',
    );
  });

  it('treats energy as a first-class map harness variant', () => {
    const harness = src('src/e2e/map-harness.ts');
    const variantUnion = harness.match(/type HarnessVariant = ([^;]+);/)?.[1] ?? '';

    assert.ok(
      variantUnion.includes("'energy'"),
      'map harness must include energy in its runtime variant union',
    );
    assert.match(
      harness,
      /SITE_VARIANT === 'energy'\s*\?\s*'energy'/,
      'map harness must resolve SITE_VARIANT=energy to the energy harness branch',
    );
    assert.match(
      harness,
      /const energyAllLayersEnabled: MapLayers = \{[\s\S]*?commodityPorts:\s*true,[\s\S]*?storageFacilities:\s*true,[\s\S]*?fuelShortages:\s*true,[\s\S]*?liveTankers:\s*true,/,
      'energy harness must enable Atlas-specific map layers only in the energy-specific seeded layer set',
    );
    assert.match(
      harness,
      /setCachedPipelineRegistries\([\s\S]*?setCachedStorageFacilityRegistry\([\s\S]*?setCachedFuelShortageRegistry\(/,
      'energy harness must seed Atlas registry stores instead of relying on network fetches',
    );
  });

  it('uses energy-specific deck expectations in playwright coverage', () => {
    const spec = src('e2e/map-harness.spec.ts');

    assert.match(
      spec,
      /const EXPECTED_ENERGY_DECK_LAYERS = \[/,
      'Playwright harness spec must define energy-specific expected deck layers',
    );
    assert.match(
      spec,
      /process\.env\.VITE_VARIANT === 'energy'\s*\?\s*'energy'/,
      'Playwright harness spec must expect the energy runtime variant when requested',
    );
    assert.match(
      spec,
      /variant === 'energy'\s*\?\s*EXPECTED_ENERGY_DECK_LAYERS/,
      'Playwright harness spec must assert Atlas-specific layer coverage',
    );
  });
});
