import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORTRAIT_STYLE, PORTRAIT_STYLE_PRESETS, portraitStylePreset } from './portraitStyles.ts';

test('offers more than ten comic portrait styles and one explicit realistic choice', () => {
  assert.ok(PORTRAIT_STYLE_PRESETS.filter(item => item.kind === 'comic').length >= 10);
  assert.equal(PORTRAIT_STYLE_PRESETS.filter(item => item.kind === 'realistic').length, 1);
  assert.equal(new Set(PORTRAIT_STYLE_PRESETS.map(item => item.id)).size, PORTRAIT_STYLE_PRESETS.length);
});

test('uses a comic portrait style by default and falls back safely', () => {
  assert.equal(portraitStylePreset(DEFAULT_PORTRAIT_STYLE).kind, 'comic');
  assert.equal(portraitStylePreset('unknown-style').id, DEFAULT_PORTRAIT_STYLE);
});
