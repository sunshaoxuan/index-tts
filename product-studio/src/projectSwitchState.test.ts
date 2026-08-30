import assert from 'node:assert/strict';
import test from 'node:test';
import { beginProjectSwitch, failProjectSwitch, isCurrentProjectSwitch } from './projectSwitchState.ts';

test('beginProjectSwitch records the requested project for immediate feedback', () => {
  assert.deepEqual(beginProjectSwitch(4, 'project-b', '远程工程 B'), {
    phase: 'loading', sequence: 4, targetId: 'project-b', targetLabel: '远程工程 B',
  });
});

test('isCurrentProjectSwitch rejects stale or mismatched responses', () => {
  const state = beginProjectSwitch(8, 'project-b', '远程工程 B');
  assert.equal(isCurrentProjectSwitch(state, 8, 'project-b'), true);
  assert.equal(isCurrentProjectSwitch(state, 7, 'project-b'), false);
  assert.equal(isCurrentProjectSwitch(state, 8, 'project-a'), false);
});

test('failProjectSwitch preserves the target details for a recoverable error', () => {
  const state = beginProjectSwitch(3, 'project-b', '远程工程 B');
  assert.deepEqual(failProjectSwitch(state, 3, 'project-b', '远程读取超时'), {
    phase: 'error', sequence: 3, targetId: 'project-b', targetLabel: '远程工程 B', message: '远程读取超时',
  });
});

test('failProjectSwitch ignores a stale failure after a newer request starts', () => {
  const current = beginProjectSwitch(6, 'project-c', '远程工程 C');
  assert.equal(failProjectSwitch(current, 5, 'project-b', '旧请求失败'), current);
});
