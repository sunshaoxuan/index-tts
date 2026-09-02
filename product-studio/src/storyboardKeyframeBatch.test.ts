import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStoryboardKeyframeQueue,
  runStoryboardKeyframeBatch,
  storyboardKeyframeProgressPercent,
  storyboardKeyframeRemainingSeconds,
  type StoryboardKeyframeBatchProgress,
} from './storyboardKeyframeBatch.ts';

test('builds a stable storyboard keyframe queue in scene and shot order', () => {
  const queue = buildStoryboardKeyframeQueue([
    { id: 'scene_a', shots: [{ id: 'shot_a1', title: '门口' }, { id: 'shot_a2', title: '窗边' }] },
    { id: 'scene_b', shots: [{ id: 'shot_b1', title: '走廊' }] },
  ]);
  assert.deepEqual(queue.map(item => [item.sceneId, item.shotId, item.title]), [
    ['scene_a', 'shot_a1', '门口'],
    ['scene_a', 'shot_a2', '窗边'],
    ['scene_b', 'shot_b1', '走廊'],
  ]);
});

test('preflights once and reports exact per-shot progress while generating sequentially', async () => {
  const items = buildStoryboardKeyframeQueue([{ id: 'scene_a', shots: [{ id: 'shot_1' }, { id: 'shot_2' }, { id: 'shot_3' }] }]);
  const calls: string[] = [];
  const progress: StoryboardKeyframeBatchProgress[] = [];
  let clock = 1_000;
  const results = await runStoryboardKeyframeBatch({
    items,
    preflight: async () => { calls.push('preflight'); clock += 1_000; },
    generate: async item => { calls.push(item.shotId); clock += 2_000; return `${item.shotId}-result`; },
    onGenerated: (item, result) => calls.push(`saved:${item.shotId}:${result}`),
    onProgress: value => progress.push(value),
    now: () => clock,
  });
  assert.deepEqual(results, ['shot_1-result', 'shot_2-result', 'shot_3-result']);
  assert.deepEqual(calls, ['preflight', 'shot_1', 'saved:shot_1:shot_1-result', 'shot_2', 'saved:shot_2:shot_2-result', 'shot_3', 'saved:shot_3:shot_3-result']);
  assert.equal(progress[0].phase, 'preflight');
  assert.deepEqual(progress.filter(item => item.phase === 'generating' && item.completed < item.total).map(item => [item.currentIndex, item.completed, item.currentShotId]), [
    [1, 0, 'shot_1'], [1, 1, 'shot_1'], [2, 1, 'shot_2'], [2, 2, 'shot_2'], [3, 2, 'shot_3'],
  ]);
  assert.equal(progress.at(-1)?.phase, 'complete');
  assert.equal(progress.at(-1)?.completed, 3);
  assert.equal(storyboardKeyframeProgressPercent(progress.at(-1)), 100);
});

test('stops on the failing shot and preserves the completed count and failure location', async () => {
  const items = buildStoryboardKeyframeQueue([{ id: 'scene_a', shots: [{ id: 'shot_1' }, { id: 'shot_2' }, { id: 'shot_3' }] }]);
  const progress: StoryboardKeyframeBatchProgress[] = [];
  const saved: string[] = [];
  await assert.rejects(runStoryboardKeyframeBatch({
    items,
    preflight: async () => undefined,
    generate: async item => {
      if (item.shotId === 'shot_2') throw new Error('图像服务超时');
      return item.shotId;
    },
    onGenerated: item => saved.push(item.shotId),
    onProgress: value => progress.push(value),
  }), /图像服务超时/);
  assert.deepEqual(saved, ['shot_1']);
  assert.deepEqual(progress.at(-1), {
    mode: 'all', phase: 'error', total: 3, completed: 1, currentIndex: 2, currentShotId: 'shot_2', currentTitle: '镜头 2',
    startedAt: progress[0].startedAt, updatedAt: progress.at(-1)?.updatedAt, errorMessage: '图像服务超时',
  });
});

test('calculates bounded progress and a remaining-time estimate from completed frames', () => {
  const progress: StoryboardKeyframeBatchProgress = { mode: 'all', phase: 'generating', total: 10, completed: 4, startedAt: 1_000, updatedAt: 9_000 };
  assert.equal(storyboardKeyframeProgressPercent(progress), 40);
  assert.equal(storyboardKeyframeRemainingSeconds(progress), 12);
  assert.equal(storyboardKeyframeProgressPercent({ ...progress, completed: 10, phase: 'generating' }), 99);
});

test('stops before the next image after cancellation and reports preserved progress', async () => {
  const items = buildStoryboardKeyframeQueue([{ id: 'scene_a', shots: [{ id: 'shot_1' }, { id: 'shot_2' }] }]);
  const controller = new AbortController();
  const generated: string[] = [];
  const progress: StoryboardKeyframeBatchProgress[] = [];
  await assert.rejects(runStoryboardKeyframeBatch({
    items,
    signal: controller.signal,
    preflight: async () => undefined,
    generate: async item => item.shotId,
    onGenerated: item => {
      generated.push(item.shotId);
      controller.abort();
    },
    onProgress: value => progress.push(value),
  }), error => error instanceof Error && error.name === 'AbortError');
  assert.deepEqual(generated, ['shot_1']);
  assert.equal(progress.at(-1)?.phase, 'cancelled');
  assert.equal(progress.at(-1)?.completed, 1);
});
