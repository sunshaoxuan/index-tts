import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatchingFragments, findMatchingFragment } from './fragmentState.ts';
import type { RenderFragment } from './api.ts';
import type { SegmentRow } from './types.ts';

const current: SegmentRow = [1, '正文', 'narrator', '旁白', 'ZH', '当前第一句。', '当前第一句。', '中性叙述', '平静', 0.5, '自然', 300];
const stale: RenderFragment = { order: 1, speakerName: '旁白', sourceText: '旧稿第一段。', synthesisText: '旧稿第一段。', effectiveText: '旧稿第一段。', appliedPronunciations: [], cacheReused: true, forcedRegeneration: false, audio: '/old.wav' };
const matching: RenderFragment = { ...stale, order: 99, sourceText: '当前第一句。', synthesisText: '当前第一句。', effectiveText: '当前第一句。', audio: '/current.wav' };

test('does not bind a stale fragment only because its historical order matches', () => {
  assert.equal(findMatchingFragment([stale], current), undefined);
});

test('matches by source and synthesis text even when a historical order changed', () => {
  assert.equal(findMatchingFragment([stale, matching], current)?.audio, '/current.wav');
  assert.equal(countMatchingFragments([stale, matching], [current]), 1);
});

test('marks the fragment stale after synthesis text is edited', () => {
  const edited = [...current] as SegmentRow;
  edited[6] = '人工改写朗读。';
  assert.equal(findMatchingFragment([matching], edited), undefined);
});
