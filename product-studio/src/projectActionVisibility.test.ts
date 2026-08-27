import assert from 'node:assert/strict';
import test from 'node:test';
import { isProjectWorkspaceVisible, nextProjectActionsExpanded } from './projectActionVisibility.ts';

test('shows project actions while any part of the project workspace is visible', () => {
  assert.equal(isProjectWorkspaceVisible({ top: 719, bottom: 1800 }, 720), true);
  assert.equal(isProjectWorkspaceVisible({ top: -120, bottom: 1 }, 720), true);
});

test('hides project actions outside the project workspace', () => {
  assert.equal(isProjectWorkspaceVisible({ top: 720, bottom: 1800 }, 720), false);
  assert.equal(isProjectWorkspaceVisible({ top: -1000, bottom: 0 }, 720), false);
});

test('expands on entering the workspace and collapses on leaving it', () => {
  assert.equal(nextProjectActionsExpanded(false, true, false), true);
  assert.equal(nextProjectActionsExpanded(true, false, true), false);
});

test('keeps a manual panel choice while the workspace visibility is unchanged', () => {
  assert.equal(nextProjectActionsExpanded(true, true, false), false);
  assert.equal(nextProjectActionsExpanded(false, false, true), true);
});
