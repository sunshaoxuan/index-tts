import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoleRow, SegmentRow } from './types.ts';
import { updateSegmentByOrder } from './segmentState.ts';

const roles: RoleRow[] = [
  ['narrator', '旁白', 'narrator', '', '', '', '', '否'],
  ['role_006', '死者妻子', 'character', '', '', '', '', '否'],
];

function segment(order: number): SegmentRow {
  return [order, '正文', 'role_006', '死者妻子', 'ZH', `原文 ${order}`, `原文 ${order}`, '中性叙述', '平静', 0.5, '自然', 300];
}

test('updates a later-page segment by stable order and synchronizes the role name', () => {
  const segments = Array.from({ length: 103 }, (_, index) => segment(index + 1));
  const updated = updateSegmentByOrder(segments, roles, 103, 2, 'narrator');

  assert.equal(updated[2][2], 'role_006');
  assert.equal(updated[102][2], 'narrator');
  assert.equal(updated[102][3], '旁白');
  assert.equal(updated.filter((row) => row[2] === 'narrator').length, 1);
});

test('rejects an unknown role without changing the segment collection', () => {
  const segments = [segment(103)];
  assert.equal(updateSegmentByOrder(segments, roles, 103, 2, 'missing-role'), segments);
});

test('returns the original collection when the stable order does not exist', () => {
  const segments = [segment(1)];
  assert.equal(updateSegmentByOrder(segments, roles, 103, 7, '严肃'), segments);
});
