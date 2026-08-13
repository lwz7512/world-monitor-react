/**
 * LiveNewsPanel instantiation guard — regression tests
 *
 * Guards against:
 *   1. Happy-variant crash: DEFAULT_LIVE_CHANNELS is [] on happy, so
 *      channel initialization must not crash on empty defaults —
 *      instead loadChannelsFromStorage() and getDefaultLiveChannels() are
 *      used as the two-step fallback chain.
 *   2. Fallback-repopulation: the guard must not fall back to
 *      FULL_LIVE_CHANNELS, which would override an intentionally empty
 *      channel set persisted by the user.
 *   3. Guard completeness: the React component's initChannels() checks both
 *      getDefaultLiveChannels() AND loadChannelsFromStorage() so users
 *      with custom-saved channels can still use the panel on happy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { newsPanelKeyForCategory } from '../src/app/news-panel-keys.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function src(relPath: string): string {
  return readFileSync(resolve(root, relPath), 'utf-8');
}

describe('LiveNewsPanel instantiation guard', () => {
  // -------------------------------------------------------------------------
  // 1. Happy variant: DEFAULT_LIVE_CHANNELS is empty
  // -------------------------------------------------------------------------

  it('DEFAULT_LIVE_CHANNELS is [] on happy variant (crash source)', () => {
    const channelsSvc = src('src/services/live-news-channels.ts');
    const match = channelsSvc.match(/DEFAULT_LIVE_CHANNELS\s*=\s*SITE_VARIANT\s*===\s*['"]tech['"]\s*\?[^:]+:\s*SITE_VARIANT\s*===\s*['"]happy['"]\s*\?\s*(\[[^\]]*\])/);
    assert.ok(match, 'DEFAULT_LIVE_CHANNELS assignment not found in live-news-channels.ts');
    assert.equal(match[1].replace(/\s/g, ''), '[]', 'happy variant DEFAULT_LIVE_CHANNELS must be []');
  });

  // -------------------------------------------------------------------------
  // 2. React component must NOT reference FULL_LIVE_CHANNELS directly
  //    (FULL_LIVE_CHANNELS is unexported; the component must go through
  //     the service functions to avoid overriding an empty saved set)
  // -------------------------------------------------------------------------

  it('LiveNewsPanel.tsx does not reference FULL_LIVE_CHANNELS directly', () => {
    const liveNewsTsx = src('src/components/panels/LiveNewsPanel.tsx');
    assert.ok(
      !liveNewsTsx.includes('FULL_LIVE_CHANNELS'),
      'LiveNewsPanel.tsx must not reference FULL_LIVE_CHANNELS — use getDefaultLiveChannels() instead',
    );
  });

  it('refreshChannelsFromStorage does not fall back to FULL_LIVE_CHANNELS', () => {
    const liveNewsTsx = src('src/components/panels/LiveNewsPanel.tsx');
    const refreshBlock = liveNewsTsx.match(/refreshChannelsFromStorage[^}]+loadChannelsFromStorage[^}]+getDefaultLiveChannels[^}]+(FULL_LIVE_CHANNELS)?/s);
    assert.ok(refreshBlock, 'refreshChannelsFromStorage block not found');
    assert.ok(
      !refreshBlock[1],
      'refreshChannelsFromStorage must not fall back to FULL_LIVE_CHANNELS',
    );
  });

  // -------------------------------------------------------------------------
  // 3. React component initChannels() checks BOTH storage AND defaults
  //    so that users with persisted custom channels on happy can still use the panel
  // -------------------------------------------------------------------------

  it('React component initChannels() safely handles empty default channels', () => {
    const liveNewsTsx = src('src/components/panels/LiveNewsPanel.tsx');
    assert.match(
      liveNewsTsx,
      /function initChannels/,
      'LiveNewsPanel.tsx must have an initChannels function for channel initialization',
    );
    assert.match(
      liveNewsTsx,
      /loadChannelsFromStorage\(\)/,
      'initChannels must call loadChannelsFromStorage()',
    );
    assert.match(
      liveNewsTsx,
      /getDefaultLiveChannels\(\)/,
      'initChannels must fall back to getDefaultLiveChannels()',
    );
  });

  it('React component channel init checks loadChannelsFromStorage then getDefaultLiveChannels', () => {
    const liveNewsTsx = src('src/components/panels/LiveNewsPanel.tsx');
    // Slice from the function declaration to the component function to get the full body
    const initStart = liveNewsTsx.indexOf('function initChannels');
    const initEnd = liveNewsTsx.indexOf('export function LiveNewsPanel()');
    assert.ok(initStart > -1 && initEnd > initStart, 'initChannels function not found');
    const initFn = liveNewsTsx.slice(initStart, initEnd);
    assert.match(initFn, /loadChannelsFromStorage/, 'initChannels must call loadChannelsFromStorage');
    assert.match(initFn, /getDefaultLiveChannels/, 'initChannels must fall back to getDefaultLiveChannels');
  });

  it('LiveNewsPanel.tsx imports both getDefaultLiveChannels and loadChannelsFromStorage', () => {
    const liveNewsTsx = src('src/components/panels/LiveNewsPanel.tsx');
    assert.ok(
      liveNewsTsx.includes('getDefaultLiveChannels'),
      'LiveNewsPanel.tsx must import getDefaultLiveChannels',
    );
    assert.ok(
      liveNewsTsx.includes('loadChannelsFromStorage'),
      'LiveNewsPanel.tsx must import loadChannelsFromStorage',
    );
  });

  // -------------------------------------------------------------------------
  // 4. Mid-session lazy instantiation path
  //    When a happy-variant user adds channels after page load, the panel
  //    must be mountable without a full reload.
  // -------------------------------------------------------------------------

  it('panel-layout.ts exposes mountLiveNewsIfReady() for mid-session instantiation', () => {
    const layout = src('src/app/panel-layout.ts');
    assert.ok(
      layout.includes('mountLiveNewsIfReady'),
      'panel-layout.ts must expose mountLiveNewsIfReady() so channels added mid-session can trigger panel creation',
    );
  });

  it('panel-tab-manager.ts calls mountLiveNewsIfReady when live channels are updated', () => {
    const tabManager = src('src/app/panel-tab-manager.ts');
    assert.ok(
      tabManager.includes('mountLiveNewsIfReady'),
      'panel-tab-manager.ts must call mountLiveNewsIfReady so channel updates trigger panel creation',
    );
  });

  it('App.ts wires mountLiveNewsIfReady callback to panelLayout', () => {
    const app = src('src/app/create-app-managers.ts');
    assert.ok(
      app.includes('mountLiveNewsIfReady'),
      'create-app-managers.ts must wire mountLiveNewsIfReady callback so event handlers can trigger lazy panel creation',
    );
  });
});

// ---------------------------------------------------------------------------
// 5. 'live-news' must NOT be shadowed by a generic RSS NewsPanel
//    Regression: #4382 (perf: split panel chunks by domain) flipped the
//    live-news video panel from an EAGER assignment (ctx.panels['live-news'] =
//    new LiveNewsPanel(), set BEFORE the CANONICAL_FEEDS loop) to a LAZY
//    registration AFTER the loop, and swapped the collision guard from the
//    dynamic `this.ctx.panels[key]` to a static `COLLIDING_NEWS_PANEL_KEYS`
//    set that omits 'live-news'. Result: the loop creates a generic NewsPanel
//    for the 'live-news' key (fed by CANONICAL_FEEDS['live-news'], the energy
//    headlines block), which registers first and — via lazyPanel's dedup
//    guard — BLOCKS the real LiveNewsPanel video registration. The live site
//    rendered "LIVE NEWS … No items in the last 7 days" instead of the 24/7
//    video streams. The loop must exclude 'live-news' so the dedicated video
//    panel owns the key.
//
//    #5871 removed `COLLIDING_NEWS_PANEL_KEYS` — that hardcoded set was itself
//    a bug source (it omitted `commodities`) and the collision is derived from
//    the live registry now. `live-news` still needs naming because it is the one
//    panel registered BELOW the loop, so the registry cannot answer for it; the
//    exception moved to `LATE_REGISTERED_PANEL_KEYS`. Both spellings are still
//    accepted below so the guard survives either shape, and the behavioural half
//    of the check now runs the real resolver rather than only grepping.
// ---------------------------------------------------------------------------

describe("live-news must not be shadowed by a generic NewsPanel (regression #4382)", () => {
  it("CANONICAL_FEEDS defines a 'live-news' key (the latent landmine)", () => {
    const feeds = src('src/config/feeds.ts');
    assert.match(
      feeds,
      /['"]live-news['"]\s*:/,
      "expected a 'live-news' entry in feeds.ts (energy headlines) — this is what lets the CANONICAL_FEEDS loop spawn a NewsPanel that shadows the video panel",
    );
  });

  it("CANONICAL_FEEDS loop in panel-layout.ts must NOT create a generic NewsPanel for 'live-news'", () => {
    const layout = src('src/app/panel-layout.ts');
    const loopStart = layout.indexOf('for (const key of Object.keys(CANONICAL_FEEDS))');
    assert.ok(loopStart !== -1, 'CANONICAL_FEEDS key loop not found in panel-layout.ts');
    const createCall = layout.indexOf('createNewsPanelWithLabel(panelKey', loopStart);
    assert.ok(createCall !== -1, 'createNewsPanelWithLabel call not found inside the loop');
    const loopRegion = layout.slice(loopStart, createCall + 200);

    const skipsLiveNews = /key\s*===\s*['"]live-news['"]/.test(loopRegion);
    const collidesLiveNews = /COLLIDING_NEWS_PANEL_KEYS\s*=\s*new Set\(\[[^\]]*['"]live-news['"]/.test(layout);
    const lateRegistersLiveNews = /LATE_REGISTERED_PANEL_KEYS(?::[^=]*)?\s*=\s*new Set\(\[[^\]]*['"]live-news['"]/.test(layout);
    // Phase 7: 'live-news' moved into PANEL_REGISTRY, which is processed via the
    // PANEL_REGISTRY loop BEFORE the CANONICAL_FEEDS loop. Being in lazyPanelRegistrations
    // before the pass makes isPanelKeyClaimed('live-news') return true, so the pass
    // tries 'live-news-news' (no settings entry) and creates nothing.
    const registrySrc = src('src/app/panel-registry.ts');
    const inPanelRegistry = /['"]live-news['"]\s*:/.test(registrySrc);

    assert.ok(
      skipsLiveNews || collidesLiveNews || lateRegistersLiveNews || inPanelRegistry,
      "panel-layout.ts must exclude 'live-news' from the CANONICAL_FEEDS NewsPanel loop " +
        "(it is the dedicated LiveNewsPanel video key). Without this, the generic NewsPanel " +
        "shadows the video panel and lazyPanel's dedup guard blocks the real one (regression #4382).",
    );
  });

  it("the real resolver refuses to create a NewsPanel for 'live-news'", () => {
    // The grep above cannot tell whether the exclusion is actually consulted. This
    // runs the production resolver with `live-news` declared claimed — the state
    // `LATE_REGISTERED_PANEL_KEYS` puts it in — and asserts it yields no panel.
    // The `live-news-news` remap must find no settings entry on any variant, so a
    // catalog entry appearing under that name would resurrect #4382 by another route.
    // The catalog, NOT panel-layout: `hasPanelSetting` reads `panelSettings`, which
    // App.ts builds from ALL_PANELS in src/config/panels.ts. Grepping panel-layout
    // for this would be an assertion that cannot fire for the case it describes.
    assert.doesNotMatch(
      src('src/config/panels.ts'),
      /['"]live-news-news['"]/,
      "nothing may define a 'live-news-news' panel — that is the key the remap parks live-news on",
    );

    assert.equal(
      newsPanelKeyForCategory('live-news', {
        isFeedCategory: () => true,
        hasNewsPanel: () => false,
        isPanelKeyClaimed: (panelKey) => panelKey === 'live-news',
        // Deliberately generous: even if every key had a settings entry, the
        // remapped key must still not be 'live-news'.
        hasPanelSetting: () => true,
      }),
      'live-news-news',
      "a claimed 'live-news' key must remap away from the video panel's key",
    );

    assert.equal(
      newsPanelKeyForCategory('live-news', {
        isFeedCategory: () => true,
        hasNewsPanel: () => false,
        isPanelKeyClaimed: (panelKey) => panelKey === 'live-news',
        hasPanelSetting: (panelKey) => panelKey !== 'live-news-news',
      }),
      null,
      "with no 'live-news-news' catalog entry — the real state — no panel may be created",
    );
  });
});
