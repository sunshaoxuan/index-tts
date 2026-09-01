import assert from 'node:assert/strict';
import test from 'node:test';
import { createManualStoryboardShot, mergeStoryboardShots, splitStoryboardShot, toggleStoryboardShotSelection } from './storyboardScenes.ts';

const draft = {
  startSegmentOrder: 2, endSegmentOrder: 3, title: '门口相遇', topic: '人物相遇', location: '旧宅门口',
  spatialDirection: '镜头从院内望向门外', time: '傍晚', narrativePerspective: '第三人称', mood: '紧张',
  storyboardNote: '斜阳把门槛切成明暗两层，两个人分立内外，镜头从院内低机位望向门外，前景保留半开的木门。', boundaryReason: '人物动作重心变化',
};

function fixture() {
  return {
    scenes: [{ id: 'scene_001', title: '旧宅', shots: [{ id: 'scene_001_shot_001', title: '原镜头', storyboard_note: '原镜头画面描述足够完整，人物沿着旧宅门廊移动。', keyframe_url: '/old.png', start_segment_order: 1, end_segment_order: 4 }] }],
    segments: [
      { order: 1, scene_id: 'scene_001', speaker_id: 'narrator' }, { order: 2, scene_id: 'scene_001', speaker_id: 'role_01' },
      { order: 3, scene_id: 'scene_001', speaker_id: 'role_02' }, { order: 4, scene_id: 'scene_001', speaker_id: 'narrator' },
    ],
  };
}

test('keeps multiple shot selections in one scene and clears selections from another scene', () => {
  assert.deepEqual(toggleStoryboardShotSelection([], ['shot_1', 'shot_2'], 'shot_1', true), ['shot_1']);
  assert.deepEqual(toggleStoryboardShotSelection(['shot_1'], ['shot_1', 'shot_2'], 'shot_2', true), ['shot_1', 'shot_2']);
  assert.deepEqual(toggleStoryboardShotSelection(['shot_1', 'shot_2'], ['shot_1', 'shot_2'], 'shot_1', false), ['shot_2']);
  assert.deepEqual(toggleStoryboardShotSelection(['shot_1', 'shot_2'], ['shot_3', 'shot_4'], 'shot_3', true), ['shot_3']);
});

test('creates one manual shot and keeps the remaining shot ranges continuous', () => {
  const result = createManualStoryboardShot(fixture(), draft);
  const shots = (result.document.scenes as Array<Record<string, unknown>>)[0].shots as Array<Record<string, unknown>>;
  assert.equal(result.shotId, 'scene_001_manual_001');
  assert.deepEqual(shots.map(shot => [shot.id, shot.start_segment_order, shot.end_segment_order]), [
    ['scene_001_shot_001', 1, 1], ['scene_001_manual_001', 2, 3], ['scene_001_split_001', 4, 4],
  ]);
  assert.equal('keyframe_url' in shots[1], false);
  assert.equal('keyframe_url' in shots[2], false);
});

test('splits and merges adjacent storyboard shots while clearing stale images', () => {
  const split = splitStoryboardShot(fixture(), 'scene_001', 'scene_001_shot_001');
  const splitShots = (split.document.scenes as Array<Record<string, unknown>>)[0].shots as Array<Record<string, unknown>>;
  assert.deepEqual(splitShots.map(shot => [shot.start_segment_order, shot.end_segment_order]), [[1, 2], [3, 4]]);
  assert.ok(splitShots.every(shot => !('keyframe_url' in shot)));

  const merged = mergeStoryboardShots(split.document, 'scene_001', splitShots.map(shot => String(shot.id)));
  const mergedShots = (merged.document.scenes as Array<Record<string, unknown>>)[0].shots as Array<Record<string, unknown>>;
  assert.deepEqual(mergedShots.map(shot => [shot.start_segment_order, shot.end_segment_order]), [[1, 4]]);
  assert.equal(mergedShots[0].authoring, 'manual_merge');
});

test('does not allow a manual shot to cross scene boundaries', () => {
  const document = fixture();
  document.scenes.push({ id: 'scene_002', title: '街道', shots: [] });
  document.segments[2].scene_id = 'scene_002';
  assert.throws(() => createManualStoryboardShot(document, draft), /同一场景/u);
});
