// Regression guard for PR #3833 follow-up: tech-readiness refresh must be
// variant-gated, not just viewport-gated.
//
// Original bug: `shouldLoad(id)` returns `forceAll || isPanelNearViewport(id)` and
// `App.ts:1226` calls `loadAllData(true)` on boot — so a `shouldLoad`-only
// gate is bypassed at startup on every variant, and tech-readiness was
// still firing its 5s `/api/bootstrap?keys=techReadiness` fetch on
// commodity/finance/energy/happy where the seed key isn't populated.
//
// React migration fix: the variant gate is now implicit via the component
// mount lifecycle. TechReadinessPanel uses `usePanelData` which only fires
// when the component mounts. The component only mounts in variants where
// `tech-readiness` is in the panel defaults. No explicit `isPanelInVariantDefaults`
// call is needed in data-loader.ts or panel-layout.ts.
//
// These tests guard the new invariant: tech-readiness must stay self-fetching
// (no data-loader task), and its registration must use createFullReactPanelLoader
// (which respects React mount lifecycle as the implicit variant gate).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function readFile(rel: string): string[] {
  return readFileSync(resolve(root, rel), 'utf-8').split('\n');
}

function stripComments(line: string): string {
  // Strip // line comments before structural matching.
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

describe('tech-readiness variant gate', () => {
  it('data-loader.ts: tech-readiness has no push task (panel is self-fetching via usePanelData)', () => {
    const lines = readFile('src/app/data-loader.ts');
    // Verify there is no task that pushes data to tech-readiness. The panel is self-fetching
    // via usePanelData; adding a data-loader task without isPanelInVariantDefaults would
    // re-introduce the original bug (fires on every variant, including ones without the seed).
    const taskLineIdx = lines.findIndex(l => /name:\s*'techReadiness'/.test(stripComments(l)));
    assert.equal(
      taskLineIdx,
      -1,
      `data-loader.ts must not have a techReadiness push task (found at line ${taskLineIdx + 1}). ` +
      'TechReadinessPanel is self-fetching via usePanelData — adding a data-loader task without ' +
      "isPanelInVariantDefaults('tech-readiness') would re-introduce the PR #3833 regression " +
      '(5s fetch fires on every variant, even ones without the seed).',
    );
  });

  it('TechReadinessPanel.tsx: fetches via usePanelData (React mount lifecycle acts as variant gate)', () => {
    const src = readFileSync(resolve(root, 'src/components/panels/TechReadinessPanel.tsx'), 'utf-8');
    assert.match(
      src,
      /usePanelData/,
      'TechReadinessPanel must fetch via usePanelData. This hook only fires when the component ' +
      'mounts, and the component only mounts in variants where tech-readiness is in the panel ' +
      "defaults — making React's mount lifecycle the implicit variant gate.",
    );
    assert.match(
      src,
      /hydrationKey:\s*['"]techReadiness['"]/,
      "TechReadinessPanel must pass hydrationKey: 'techReadiness' to usePanelData so it reads " +
      'from the bootstrap cache on variants that have the seed.',
    );
  });

  it("panel-layout.ts: tech-readiness uses createFullReactPanelLoader (no bare p.refresh() outside variant gate)", () => {
    const lines = readFile('src/app/panel-layout.ts');
    // Find the lazy panel registration for tech-readiness.
    const lazyIdx = lines.findIndex(l => /lazyPanel\(\s*['"]tech-readiness['"]/.test(stripComments(l)));
    assert.ok(lazyIdx !== -1, "expected tech-readiness lazy panel registration in panel-layout.ts");

    // Collect the factory body — walk forward until the call closes.
    const body: { lineNo: number; text: string }[] = [];
    let depth = 0;
    let started = false;
    for (let i = lazyIdx; i < Math.min(lines.length, lazyIdx + 30); i++) {
      const text = stripComments(lines[i]);
      body.push({ lineNo: i + 1, text });
      for (const ch of text) {
        if (ch === '(') { depth++; started = true; }
        else if (ch === ')') { depth--; }
      }
      if (started && depth === 0) break;
    }
    assert.ok(body.length > 1, 'expected to walk the lazy panel factory body');
    const bodyText = body.map(b => b.text).join('\n');

    // Must use createFullReactPanelLoader — the React lifecycle acts as the implicit variant gate.
    assert.match(
      bodyText,
      /createFullReactPanelLoader/,
      "panel-layout.ts tech-readiness registration must use createFullReactPanelLoader. " +
      "This ensures the panel only mounts (and therefore only fetches) in variants where " +
      "tech-readiness appears in the panel defaults.",
    );

    // Must NOT have a bare p.refresh() outside an isPanelInVariantDefaults guard.
    // If someone adds p.refresh() back without the guard, the fetch fires on every variant.
    const refreshLines = body.filter(b => /\bp\.refresh\(\s*\)/.test(b.text));
    const ungatedRefresh = refreshLines.filter(b =>
      !bodyText.slice(0, bodyText.indexOf(b.text)).match(
        /isPanelInVariantDefaults\(\s*['"]tech-readiness['"]\s*\)/
      )
    );
    assert.equal(
      ungatedRefresh.length,
      0,
      `panel-layout.ts tech-readiness factory has ${ungatedRefresh.length} p.refresh() call(s) ` +
      "outside an isPanelInVariantDefaults('tech-readiness') guard. Either remove p.refresh() " +
      "(self-fetching via usePanelData) or add the variant gate.",
    );
  });

  it('panels.ts: isPanelInVariantDefaults is exported from @/config barrel', () => {
    const barrel = readFileSync(resolve(root, 'src/config/index.ts'), 'utf-8');
    assert.match(
      barrel,
      /isPanelInVariantDefaults/,
      'src/config/index.ts must re-export isPanelInVariantDefaults so call sites can import it from @/config',
    );
  });
});
