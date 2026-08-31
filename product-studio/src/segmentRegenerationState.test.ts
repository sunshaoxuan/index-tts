import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  beginSegmentRegeneration,
  segmentRegenerationButtonLabel,
  segmentRegenerationStatusMessage,
  submitSegmentRegeneration,
} from './segmentRegenerationState.ts';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('starts visible feedback in the saving or submitting phase', () => {
  assert.deepEqual(beginSegmentRegeneration(7, true), { phase: 'saving', order: 7 });
  assert.deepEqual(beginSegmentRegeneration(7, false), { phase: 'submitting', order: 7 });
  assert.deepEqual(submitSegmentRegeneration(7), { phase: 'submitting', order: 7 });
  assert.equal(segmentRegenerationButtonLabel(beginSegmentRegeneration(7, true)), '正在保存分句 7…');
  assert.equal(segmentRegenerationStatusMessage(submitSegmentRegeneration(7)), '正在向服务器提交分句 7 的生成请求');
});

test('locks duplicate clicks synchronously before either network request', () => {
  const handler = app.slice(app.indexOf('const regenerateSegment'), app.indexOf('const assembleExistingFragments'));
  assert.match(handler, /segmentRegenerationOrderRef\.current !== undefined/);
  assert.match(handler, /segmentRegenerationOrderRef\.current = order;[\s\S]*setSegmentRegeneration\(beginSegmentRegeneration\(order, dirty\)\)/);
  assert.match(handler, /setSegmentRegeneration\(beginSegmentRegeneration\(order, dirty\)\)[\s\S]*await save\(\)[\s\S]*await api\.regenerateSegment/);
  assert.match(handler, /finally \{[\s\S]*segmentRegenerationOrderRef\.current = undefined;[\s\S]*setSegmentRegeneration\(\{ phase: 'idle' \}\)/);
});

test('renders an assertive high contrast locked state on the active row', () => {
  assert.match(app, /loading=\{regenerationPending\}/);
  assert.match(app, /disabled=\{jobRunning \|\| segmentRegenerationActive\}/);
  assert.match(app, /role="status" aria-live="assertive"/);
  assert.match(app, /按钮已锁定，服务器响应前无法再次提交/);
  assert.match(styles, /\.segment-regeneration-button\.is-pending/);
  assert.match(styles, /\.segment-regeneration-status/);
});
