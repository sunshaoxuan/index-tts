import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampProjectActionDockPlacement,
  nearestProjectActionDockEdge,
  normalizeProjectActionDockPlacement,
  projectActionDockOffset,
} from './projectActionDock.ts';

test('selects every viewport edge from the nearest pointer position', () => {
  assert.equal(nearestProjectActionDockEdge(500, 4, 1000, 700), 'top');
  assert.equal(nearestProjectActionDockEdge(996, 350, 1000, 700), 'right');
  assert.equal(nearestProjectActionDockEdge(500, 696, 1000, 700), 'bottom');
  assert.equal(nearestProjectActionDockEdge(4, 350, 1000, 700), 'left');
});

test('uses the along-edge pointer coordinate as the dock offset', () => {
  assert.equal(projectActionDockOffset('left', 40, 320), 320);
  assert.equal(projectActionDockOffset('right', 960, 320), 320);
  assert.equal(projectActionDockOffset('top', 440, 20), 440);
  assert.equal(projectActionDockOffset('bottom', 440, 680), 440);
});

test('keeps an expanded dock fully inside the viewport', () => {
  assert.deepEqual(clampProjectActionDockPlacement({ edge: 'left', offset: 4 }, 1000, 700, 190, 180), { edge: 'left', offset: 98 });
  assert.deepEqual(clampProjectActionDockPlacement({ edge: 'bottom', offset: 996 }, 1000, 700, 190, 180), { edge: 'bottom', offset: 897 });
});

test('normalizes persisted placement and falls back to right center', () => {
  assert.deepEqual(normalizeProjectActionDockPlacement({ edge: 'top', offset: 420 }, 1000, 700), { edge: 'top', offset: 420 });
  assert.deepEqual(normalizeProjectActionDockPlacement({ edge: 'diagonal', offset: 1 }, 1000, 700), { edge: 'right', offset: 350 });
});
