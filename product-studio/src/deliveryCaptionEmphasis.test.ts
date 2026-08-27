import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('active delivery caption enlarges both speaker and script text', () => {
  assert.match(styles, /\.delivery-caption-active > span \{[^}]*font-size: 12px;[^}]*font-weight: 750;/s);
  assert.match(styles, /\.delivery-caption-active p \{[^}]*font-size: 16px;[^}]*font-weight: 620;/s);
});

test('active delivery caption plays a short focus animation and settles at its layout size', () => {
  assert.match(styles, /\.delivery-caption-active \{[^}]*animation: delivery-caption-focus 400ms/s);
  assert.match(styles, /@keyframes delivery-caption-focus \{[\s\S]*?100% \{ transform: scale\(1\); \}[\s\S]*?\}/);
  assert.doesNotMatch(styles, /\.delivery-caption-active \{[^}]*transform: scale\(/s);
});

test('delivery caption focus animation respects reduced motion', () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.delivery-caption-active \{ animation: none; \}\s*\}/s);
});

test('mobile delivery captions stack the speaker above a full-width script', () => {
  assert.match(styles, /@media \(max-width: 800px\) \{[\s\S]*?\.delivery-caption \{ grid-template-columns: minmax\(0, 1fr\); gap: 5px; \}[\s\S]*?\}/);
});
