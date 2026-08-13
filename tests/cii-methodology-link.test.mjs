import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

function read(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('CIIPanel visible methodology link', () => {
  it('renders the CII methodology URL in panel content outside the tooltip', () => {
    const src = read('src/components/panels/CIIPanel.tsx');
    assert.match(src, /export const CII_METHODOLOGY_HREF = '\/docs\/methodology\/cii-risk-scores';/);
    // React: footer rendered as JSX div with className, not a class method
    assert.match(src, /className="cii-methodology-footer"/);
    assert.match(src, /href=\{CII_METHODOLOGY_HREF\}/);
    // Footer must appear in both the data mode and the unavailable mode render paths
    const footerCount = (src.match(/cii-methodology-footer/g) ?? []).length;
    assert.ok(footerCount >= 2, `cii-methodology-footer must appear in at least 2 render paths, found ${footerCount}`);
  });

  it('styles the visible footer as an in-panel link', () => {
    const css = read('src/styles/main.css');
    assert.match(css, /\.cii-methodology-footer\s*\{/);
    assert.match(css, /\.cii-methodology-footer a\s*\{/);
  });
});
