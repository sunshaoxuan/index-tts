import test from 'node:test';
import assert from 'node:assert/strict';
import { SEGMENT_TABLE_MIN_BODY_HEIGHT, segmentTableBodyHeight } from './segmentTableHeight.ts';

test('segment table fills the available height on a tall viewport', () => {
  assert.equal(segmentTableBodyHeight(2027, 690), 1205);
});

test('segment table preserves a usable minimum body height', () => {
  assert.equal(segmentTableBodyHeight(900, 420), SEGMENT_TABLE_MIN_BODY_HEIGHT);
});

test('segment table safely normalizes invalid measurements', () => {
  assert.equal(segmentTableBodyHeight(Number.NaN, Number.NaN), SEGMENT_TABLE_MIN_BODY_HEIGHT);
  assert.equal(segmentTableBodyHeight(1200, -80), 1068);
});
