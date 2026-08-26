import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('uses a taller face-focused crop for character card portraits', () => {
  assert.match(styles, /\.character-portrait\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3;/s);
  assert.match(styles, /\.character-portrait img\s*\{[^}]*object-position:\s*50%\s+22%;/s);
});
