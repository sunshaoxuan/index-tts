import assert from 'node:assert/strict';
import test from 'node:test';
import { nextProjectActionDisplay, projectActionAvailability, projectActionDisabledReason, projectActionTargetWorkspace } from './projectActionMode.ts';

test('changes toolbar visibility only for manual controls and idle timeout', () => {
  assert.equal(nextProjectActionDisplay(false, 'manual-expand'), true);
  assert.equal(nextProjectActionDisplay(true, 'manual-collapse'), false);
  assert.equal(nextProjectActionDisplay(true, 'idle-timeout'), false);
});

test('keeps project generation actions available from every workspace', () => {
  const ready = { jobRunning: false, dirty: false, hasSource: true, hasRoles: true, hasSegments: true };
  for (const workspace of ['source', 'roles', 'delivery', 'segments']) {
    assert.deepEqual(projectActionAvailability(ready), { settings: true, save: false, analyze: true, voice: true, render: true }, workspace);
  }
});

test('keeps save global while honoring task locks and data prerequisites', () => {
  assert.deepEqual(projectActionAvailability({ jobRunning: false, dirty: true, hasSource: true, hasRoles: true, hasSegments: true }), { settings: true, save: true, analyze: true, voice: true, render: true });
  assert.deepEqual(projectActionAvailability({ jobRunning: true, dirty: true, hasSource: true, hasRoles: true, hasSegments: true }), { settings: true, save: false, analyze: false, voice: false, render: false });
  assert.equal(projectActionAvailability({ jobRunning: false, dirty: false, hasSource: false, hasRoles: true, hasSegments: true }).analyze, false);
});

test('explains unavailable actions and maps successful actions to their result workspace', () => {
  const empty = { jobRunning: false, dirty: false, hasSource: false, hasRoles: false, hasSegments: false };
  assert.equal(projectActionDisabledReason('analyze', empty), '请先填写作品原文');
  assert.equal(projectActionDisabledReason('voice', empty), '请先完成角色分析或建立角色');
  assert.equal(projectActionDisabledReason('render', empty), '请先完成分句分析');
  assert.equal(projectActionDisabledReason('render', { ...empty, jobRunning: true }), '当前有后台任务正在运行，请等待任务结束');
  assert.equal(projectActionDisabledReason('render', { ...empty, hasSegments: true }), undefined);
  assert.equal(projectActionTargetWorkspace('analyze'), 'source');
  assert.equal(projectActionTargetWorkspace('voice'), 'roles');
  assert.equal(projectActionTargetWorkspace('render'), 'delivery');
});
