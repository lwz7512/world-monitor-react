import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// React migration: App.ts class deleted; cap-drop logic moved to useFollowedCountriesCapDrop.ts
const appSrc = readFileSync(resolve(ROOT, 'src/hooks/useFollowedCountriesCapDrop.ts'), 'utf8');

describe('followed countries cap-drop toast wiring', () => {
  it('App listens for the cap-drop event exactly once at the app level', () => {
    assert.match(
      appSrc,
      /WM_FOLLOWED_COUNTRIES_CAP_DROP/,
      'useFollowedCountriesCapDrop must import/listen for the cap-drop event emitted by followed-countries handoff',
    );
    assert.match(
      appSrc,
      /window\.addEventListener\(WM_FOLLOWED_COUNTRIES_CAP_DROP, onCapDrop\)/,
      'hook must install one cap-drop listener',
    );
    assert.match(
      appSrc,
      /window\.removeEventListener\(WM_FOLLOWED_COUNTRIES_CAP_DROP, onCapDrop\)/,
      'hook cleanup must remove the cap-drop listener',
    );
  });

  it('cap-drop listener renders an actionable upgrade toast', () => {
    assert.match(
      appSrc,
      /wm-followed-cap-drop-toast update-toast/,
      'cap-drop toast should use the existing update-toast surface',
    );
    assert.match(
      appSrc,
      /Follow limit reached/,
      'toast title must explain why follows were dropped',
    );
    assert.match(
      appSrc,
      /free plan supports \$\{FREE_TIER_FOLLOW_LIMIT\} followed countries/,
      'toast detail must explain the free-tier cap',
    );
    assert.match(
      appSrc,
      /window\.open\('\/pro#pricing', '_blank', 'noopener,noreferrer'\)/,
      'toast must give the user an upgrade action without exposing window.opener or referrer',
    );
    assert.match(
      appSrc,
      /toast\.setAttribute\('role', 'status'\)/,
      'toast must announce the cap drop to assistive technology',
    );
    assert.match(
      appSrc,
      /toast\.setAttribute\('aria-live', 'polite'\)/,
      'toast announcement should be polite, not interruptive',
    );
  });
});
