import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  beginSegmentRegeneration,
  runSegmentRegeneration,
  segmentRowEditorLocked,
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
  assert.deepEqual(runSegmentRegeneration(7), { phase: 'running', order: 7 });
  assert.equal(segmentRegenerationButtonLabel(beginSegmentRegeneration(7, true)), '正在保存分句 7…');
  assert.equal(segmentRegenerationStatusMessage(submitSegmentRegeneration(7)), '正在向服务器提交分句 7 的生成请求');
  assert.equal(segmentRegenerationButtonLabel(runSegmentRegeneration(7)), '正在生成分句 7…');
  assert.equal(segmentRegenerationStatusMessage(runSegmentRegeneration(7)), '分句 7 正在后台生成，其他分句仍可编辑');
});

test('locks only the target row for single-segment work and every row for full-page work', () => {
  const running = runSegmentRegeneration(7);
  assert.equal(segmentRowEditorLocked(true, running, 7), true);
  assert.equal(segmentRowEditorLocked(true, running, 8), false);
  assert.equal(segmentRowEditorLocked(false, beginSegmentRegeneration(7, true), 7), true);
  assert.equal(segmentRowEditorLocked(false, beginSegmentRegeneration(7, true), 8), false);
  assert.equal(segmentRowEditorLocked(true, { phase: 'idle' }, 7), true);
  assert.equal(segmentRowEditorLocked(false, { phase: 'idle' }, 7), false);
});

test('locks duplicate clicks synchronously before either network request', () => {
  const handler = app.slice(app.indexOf('const regenerateSegment'), app.indexOf('const assembleExistingFragments'));
  assert.match(handler, /segmentRegenerationOrderRef\.current !== undefined/);
  assert.match(handler, /segmentRegenerationOrderRef\.current = order;[\s\S]*setSegmentRegeneration\(beginSegmentRegeneration\(order, dirty\)\)/);
  assert.match(handler, /setSegmentRegeneration\(beginSegmentRegeneration\(order, dirty\)\)[\s\S]*await save\(\)[\s\S]*await api\.regenerateSegment/);
  assert.match(handler, /setSegmentRegeneration\(runSegmentRegeneration\(order\)\)/);
  assert.match(handler, /finally \{[\s\S]*segmentRegenerationOrderRef\.current = undefined;/);
});

test('preserves edits made to other rows while the initial snapshot is saving and after the job completes', () => {
  const setSegmentHandler = app.slice(app.indexOf('const setSegment'), app.indexOf('const applyBulkSegmentPace'));
  const emotionDirectionHandler = app.slice(app.indexOf('const setEmotionDirection'), app.indexOf('const mergeSelected'));
  const saveHandler = app.slice(app.indexOf('const save = async'), app.indexOf('const runJob'));
  const pollingEffect = app.slice(app.indexOf("if (!job || ['complete'"), app.indexOf('useEffect(() => () =>'));
  assert.match(setSegmentHandler, /segmentRowEditorLocked\(jobRunning, segmentRegeneration, order\)/);
  assert.match(setSegmentHandler, /projectRef\.current = updated/);
  assert.match(emotionDirectionHandler, /segmentRowEditorLocked\(jobRunning, segmentRegeneration, order\)/);
  assert.match(emotionDirectionHandler, /projectRef\.current = updated/);
  assert.match(saveHandler, /projectRef\.current = requestedProject/);
  assert.match(saveHandler, /projectRef\.current !== requestedProject/);
  assert.match(saveHandler, /保存期间产生的新修改继续保留为未保存状态/);
  assert.match(pollingEffect, /if \(singleSegmentJob\)[\s\S]*setProject\(current => current\?\.project_id === updated\.project_id \? current : updated\)/);
  assert.match(app, /当前只锁定目标分句行，其他分句仍可编辑/);
});

test('renders an assertive high contrast locked state on the active row', () => {
  assert.match(app, /loading=\{regenerationPending\}/);
  assert.match(app, /const rowEditorLocked = segmentRowEditorLocked\(jobRunning, segmentRegeneration, row\[0\]\)/);
  assert.match(app, /disabled=\{rowEditorLocked\}/);
  assert.match(app, /disabled=\{jobRunning \|\| segmentRegenerationActive\}/);
  assert.match(app, /role="status" aria-live="assertive"/);
  assert.match(app, /当前行已锁定，其他分句仍可编辑/);
  assert.match(styles, /\.segment-regeneration-button\.is-pending/);
  assert.match(styles, /\.segment-regeneration-status/);
});
