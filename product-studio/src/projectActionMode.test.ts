import assert from 'node:assert/strict';
import test from 'node:test';
import { nextProjectActionDisplay, projectActionAvailability } from './projectActionMode.ts';

test('changes toolbar visibility only for manual controls and idle timeout', () => {
  assert.equal(nextProjectActionDisplay(false, 'manual-expand'), true);
  assert.equal(nextProjectActionDisplay(true, 'manual-collapse'), false);
  assert.equal(nextProjectActionDisplay(true, 'idle-timeout'), false);
});

test('enables each generation action only in its matching workspace', () => {
  const ready = { jobRunning: false, dirty: false, hasSource: true, hasRoles: true, hasSegments: true };
  assert.deepEqual(projectActionAvailability('source', ready), { settings: true, save: false, analyze: true, voice: false, render: false });
  assert.deepEqual(projectActionAvailability('roles', ready), { settings: true, save: false, analyze: false, voice: true, render: false });
  assert.deepEqual(projectActionAvailability('delivery', ready), { settings: true, save: false, analyze: false, voice: false, render: true });
  assert.deepEqual(projectActionAvailability('segments', ready), { settings: true, save: false, analyze: false, voice: false, render: false });
});

test('keeps save global while honoring task locks and data prerequisites', () => {
  assert.deepEqual(projectActionAvailability('scenes', { jobRunning: false, dirty: true, hasSource: true, hasRoles: true, hasSegments: true }), { settings: true, save: true, analyze: false, voice: false, render: false });
  assert.deepEqual(projectActionAvailability('source', { jobRunning: true, dirty: true, hasSource: true, hasRoles: true, hasSegments: true }), { settings: true, save: false, analyze: false, voice: false, render: false });
  assert.equal(projectActionAvailability('source', { jobRunning: false, dirty: false, hasSource: false, hasRoles: true, hasSegments: true }).analyze, false);
});
