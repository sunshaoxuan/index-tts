import assert from 'node:assert/strict';
import test from 'node:test';
import { dominantWheelAxis, shouldPreventScrollChain } from './scrollContainment.ts';

test('selects the dominant wheel axis without turning equal deltas horizontal', () => {
  assert.equal(dominantWheelAxis(30, 10), 'horizontal');
  assert.equal(dominantWheelAxis(10, 30), 'vertical');
  assert.equal(dominantWheelAxis(20, 20), 'vertical');
});

test('prevents scroll chaining only at the requested boundary', () => {
  assert.equal(shouldPreventScrollChain(-120, 0, 900), true);
  assert.equal(shouldPreventScrollChain(120, 900, 900), true);
  assert.equal(shouldPreventScrollChain(-120, 350, 900), false);
  assert.equal(shouldPreventScrollChain(120, 350, 900), false);
  assert.equal(shouldPreventScrollChain(0, 0, 900), false);
});

test('contains both directions when a scroll surface has no available range', () => {
  assert.equal(shouldPreventScrollChain(-1, 0, 0), true);
  assert.equal(shouldPreventScrollChain(1, 0, 0), true);
});
