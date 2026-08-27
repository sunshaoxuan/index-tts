import assert from 'node:assert/strict';
import test from 'node:test';
import { isProjectWorkspaceVisible } from './projectActionVisibility.ts';

test('shows project actions while any part of the project workspace is visible', () => {
  assert.equal(isProjectWorkspaceVisible({ isIntersecting: true, intersectionRatio: 0.001 }), true);
  assert.equal(isProjectWorkspaceVisible({ isIntersecting: true, intersectionRatio: 1 }), true);
});

test('hides project actions outside the project workspace', () => {
  assert.equal(isProjectWorkspaceVisible({ isIntersecting: false, intersectionRatio: 0 }), false);
  assert.equal(isProjectWorkspaceVisible({ isIntersecting: true, intersectionRatio: 0 }), false);
});
