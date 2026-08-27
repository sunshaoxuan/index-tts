import assert from 'node:assert/strict';
import test from 'node:test';
import { activeCaptionIndex, buildCaptionTimeline } from './subtitleTimeline.ts';

const captions = [
  { order: 1, speakerName: '旁白', text: '第一句。', durationSeconds: 2, pauseAfterMs: 500 },
  { order: 2, speakerName: '笹垣润三', text: '第二句。', durationSeconds: 3, pauseAfterMs: 200 },
];

test('builds a cumulative timeline from real fragment duration and pause', () => {
  const timeline = buildCaptionTimeline(captions);
  assert.deepEqual(timeline.map(item => [item.startSeconds, item.endSeconds]), [[0, 2.5], [2.5, 5.7]]);
});

test('selects the caption at playback and seek boundaries', () => {
  const timeline = buildCaptionTimeline(captions);
  assert.equal(activeCaptionIndex(timeline, 0), 0);
  assert.equal(activeCaptionIndex(timeline, 2.49), 0);
  assert.equal(activeCaptionIndex(timeline, 2.5), 1);
  assert.equal(activeCaptionIndex(timeline, 5.7), 1);
});

test('normalizes invalid timing data without losing caption order', () => {
  const timeline = buildCaptionTimeline([{ order: 3, speakerName: '旁白', text: '内容', durationSeconds: Number.NaN, pauseAfterMs: -10 }]);
  assert.equal(timeline[0].startSeconds, 0);
  assert.equal(timeline[0].endSeconds, 0);
  assert.equal(activeCaptionIndex(timeline, 4), 0);
});
