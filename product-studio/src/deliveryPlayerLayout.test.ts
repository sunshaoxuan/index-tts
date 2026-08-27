import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('delivery player uses the padded parent content width', () => {
  assert.match(styles, /\.studio-audio \{[^}]*width: 100%;[^}]*min-width: 0;/s);
  assert.doesNotMatch(styles, /\.studio-audio \{[^}]*width: min\(720px, calc\(100vw - 96px\)\)/s);
});

test('delivery time labels remain visible while the progress track can shrink', () => {
  assert.match(styles, /grid-template-columns: 42px max-content minmax\(0, 1fr\) max-content/);
  assert.match(styles, /\.studio-audio span \{[^}]*white-space: nowrap/s);
  assert.match(styles, /\.studio-audio input\[type="range"\] \{[^}]*min-width: 0/s);
});
