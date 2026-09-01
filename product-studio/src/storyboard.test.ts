import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneAudioRanges, DEFAULT_STORYBOARD_STYLE, formatStoryboardTime, STORYBOARD_STYLE_PRESETS, storyboardStylePreset } from './storyboard.ts';

test('offers selectable illustrated and realistic storyboard styles with a stable fallback', () => {
  assert.ok(STORYBOARD_STYLE_PRESETS.filter(item => item.kind === 'illustrated').length >= 8);
  assert.ok(STORYBOARD_STYLE_PRESETS.some(item => item.kind === 'realistic'));
  assert.equal(storyboardStylePreset('unknown').id, DEFAULT_STORYBOARD_STYLE);
});

test('derives each scene start and end from rendered caption durations and pauses', () => {
  const ranges = buildSceneAudioRanges(
    [
      { order: 1, scene_id: 'scene_001' },
      { order: 2, scene_id: 'scene_001' },
      { order: 3, scene_id: 'scene_002' },
    ],
    [
      { order: 1, speakerName: '旁白', text: '一', durationSeconds: 1.25, pauseAfterMs: 250 },
      { order: 2, speakerName: '旁白', text: '二', durationSeconds: 2, pauseAfterMs: 500 },
      { order: 3, speakerName: '角色', text: '三', durationSeconds: 3.125, pauseAfterMs: 0 },
    ],
  );
  assert.deepEqual(ranges.scene_001, { startSeconds: 0, endSeconds: 4, startOrder: 1, endOrder: 2 });
  assert.deepEqual(ranges.scene_002, { startSeconds: 4, endSeconds: 7.125, startOrder: 3, endOrder: 3 });
  assert.equal(formatStoryboardTime(ranges.scene_002.startSeconds), '00:04.000');
  assert.equal(formatStoryboardTime(ranges.scene_002.endSeconds), '00:07.125');
});

test('omits timing when no rendered audio captions exist', () => {
  assert.deepEqual(buildSceneAudioRanges([{ order: 1, scene_id: 'scene_001' }], []), {});
});
