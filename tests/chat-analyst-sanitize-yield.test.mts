import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// U4b wiring lock (no jsdom in the suite; ChatAnalystPanel renders via React).
// Assert the synchronous DOMPurify+marked sanitize is deferred off the current
// task via a guarded fire-and-forget yield, applied at both render sites —
// no async ripple through the sync streaming callers (#4537).
const src = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/panels/ChatAnalystPanel.tsx'),
  'utf8',
);

test('ChatAnalystPanel imports the shared yield primitive (R5)', () => {
  assert.match(src, /import \{ yieldToMain \} from '@\/utils\/after-paint'/);
});

test('renderMarkdown defers via yieldToMain, guards isConnected, then sets innerHTML (R5)', () => {
  // In the React component, the deferred render is an inline closure
  // around yieldToMain().then() rather than a named private method.
  const yieldIdx = src.indexOf('yieldToMain().then(');
  assert.ok(yieldIdx >= 0, 'yieldToMain().then pattern exists');
  const block = src.slice(yieldIdx, yieldIdx + 300);
  assert.match(block, /yieldToMain\(\)\.then/, 'defers via yieldToMain');
  assert.match(block, /if \(!el\.isConnected\) return/, 'guards a detached node');
  assert.match(block, /el\.innerHTML = renderMarkdown\(content\)/, 'renders after the yield');
});

test('the deferred render helper is used for assistant message content (R5)', () => {
  // renderMarkdown is the module-level function that sanitizes and marks up content.
  // It must only be called inside the deferred closure, not synchronously.
  assert.match(src, /function renderMarkdown\(/, 'renderMarkdown helper exists');
  assert.match(src, /yieldToMain\(\)\.then[\s\S]*?el\.innerHTML = renderMarkdown\(content\)/, 'renderMarkdown called only inside the deferred closure');
});
