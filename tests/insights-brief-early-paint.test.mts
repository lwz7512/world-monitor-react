import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// #4890: `#insightsContent .insights-brief-text` is the field LCP element in
// ~1/3 of desktop views (DebugBear lcpSelector, p75 4344ms) because the World
// Brief only paints after clusters + hydration + sentiment complete. For
// repeat visitors the previous brief is already in the persistent cache, so
// the panel must paint it at construction time (shell paint, ~600ms) and let
// the first real update pass overwrite it. These are source-pattern guards
// (InsightsPanel is DOM-heavy; repo convention — see
// insights-brief-sources-static.test.mts).
const source = readFileSync(new URL('../src/components/panels/InsightsPanel.tsx', import.meta.url), 'utf8');

describe('InsightsPanel early cached-brief paint (#4890)', () => {
  it('triggers the early cached-brief paint from the mount effect', () => {
    // React equivalent of the class constructor calling paintCachedBriefEarly():
    // a run-once useEffect loads the cached brief and sets panel state.
    assert.match(
      source,
      /useEffect\(\(\) => \{[\s\S]*getPersistentCache/,
      'the mount effect must start the early cached-brief paint so the LCP text can land with the shell',
    );
  });

  it('guards the early paint against racing a real update on both sides of the await', () => {
    // The early-paint reads updateGenerationRef BEFORE the async cache call,
    // then re-checks it AFTER (because a real update may arrive during the await).
    const genBeforeIdx = source.indexOf('const gen = updateGenerationRef.current;');
    assert.ok(genBeforeIdx >= 0, 'must capture updateGenerationRef before the cache read');

    const cacheIdx = source.indexOf('getPersistentCache', genBeforeIdx);
    assert.ok(cacheIdx > genBeforeIdx, 'getPersistentCache must be called AFTER reading updateGenerationRef');

    // After the async cache read, updateGenerationRef must be checked again
    // before consuming the result.
    const afterCacheBlock = source.slice(cacheIdx, cacheIdx + 500);
    assert.match(
      afterCacheBlock,
      /updateGenerationRef\.current[\s\S]*?entry\?\.data\?\.summary/,
      'must re-check updateGeneration AFTER the async cache read',
    );

    // React: early paint sets panel state with the cached worldBrief (no separate badge call;
    // the class-based setDataBadge is replaced by the React state's worldBrief field).
    assert.match(
      source,
      /worldBrief:\s*entry\.data\.summary/,
      'the early paint must populate worldBrief from the persistent cache entry',
    );
  });

  it('server-insights renders persist the brief so the NEXT boot has something to early-paint', () => {
    assert.match(
      source,
      /setPersistentCache\(BRIEF_CACHE_KEY, \{ summary: serverInsights\.worldBrief, sources: worldBriefSources \}\)/,
      'the server path must write the persistent brief cache',
    );
    assert.doesNotMatch(
      source,
      /worldBriefSources\.slice\(0,\s*6\)/,
      '#4928: the server brief cites up to 12 sources — re-capping the persisted list at 6 orphans [7]/[8] citations in the early paint',
    );
  });

  it('reads the cached brief with the citation-space bound, not the legacy 6 cap', () => {
    assert.match(
      source,
      /normalizeCachedBriefSources\(entry\.data, BRIEF_CACHE_MAX_SOURCES\)/,
      'the cache read must use the shared 12-source citation bound',
    );
  });
});
