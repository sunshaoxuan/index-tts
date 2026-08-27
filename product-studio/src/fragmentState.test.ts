import assert from 'node:assert/strict';
import test from 'node:test';
import { countMatchingFragments, filterSegmentsWithoutMatchingFragments, findMatchingFragment } from './fragmentState.ts';
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

test('filters to missing fragments while preserving current segment order', () => {
  const second: SegmentRow = [2, '正文', 'narrator', '旁白', 'ZH', '需要生成的第二句。', '需要生成的第二句。', '中性叙述', '平静', 0.5, '自然', 300];
  const fourth: SegmentRow = [4, '正文', 'narrator', '旁白', 'ZH', '需要生成的第四句。', '需要生成的第四句。', '中性叙述', '平静', 0.5, '自然', 300];

  assert.deepEqual(filterSegmentsWithoutMatchingFragments([matching], [current, second, fourth]).map(row => row[0]), [2, 4]);
  const generatedSecond: RenderFragment = { ...matching, sourceText: second[5], synthesisText: second[6], effectiveText: second[6], audio: '/second.wav' };
  assert.deepEqual(filterSegmentsWithoutMatchingFragments([matching, generatedSecond], [current, second, fourth]).map(row => row[0]), [4]);
});
