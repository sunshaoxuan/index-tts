import test from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENT_PAGE_SIZE_OPTIONS, clampSegmentPage } from './segmentPagination.ts';

test('offers the four explicit segment page sizes', () => {
  assert.deepEqual(SEGMENT_PAGE_SIZE_OPTIONS, [10, 20, 50, 100]);
});

test('keeps a valid page and clamps pages after page size or row count changes', () => {
  assert.equal(clampSegmentPage(3, 133, 20), 3);
  assert.equal(clampSegmentPage(7, 133, 50), 3);
  assert.equal(clampSegmentPage(2, 0, 20), 1);
  assert.equal(clampSegmentPage(0, 133, 10), 1);
});
