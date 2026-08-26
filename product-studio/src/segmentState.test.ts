import assert from 'node:assert/strict';
import test from 'node:test';
import type { RoleRow, SegmentRow } from './types.ts';
import { mergeAdjacentSegments, splitSegmentAtOffset, suggestSplitOffset, updateSegmentByOrder } from './segmentState.ts';

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

test('keeps an edited synthesis text in the project segment state', () => {
  const segments = [segment(21), segment(22)];
  const edited = '笹垣衔了根和平牌香烟，擦火柴点zhao2，瞄了一下那份报纸，';
  const updated = updateSegmentByOrder(segments, roles, 21, 6, edited);

  assert.notEqual(updated, segments);
  assert.notEqual(updated[0], segments[0]);
  assert.equal(updated[0][5], '原文 21');
  assert.equal(updated[0][6], edited);
  assert.equal(updated[1], segments[1]);
});

test('merges two or more adjacent rows and keeps final pause while resequencing', () => {
  const rows = [segment(1), segment(2), segment(3), segment(4)];
  rows[1][5] = '第二句，'; rows[1][6] = '第二句，'; rows[1][11] = 250;
  rows[2][5] = '继续。'; rows[2][6] = '继续。'; rows[2][11] = 900;

  const merged = mergeAdjacentSegments(rows, [2, 3]);

  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map(row => row[0]), [1, 2, 3]);
  assert.equal(merged[1][5], '第二句，继续。');
  assert.equal(merged[1][6], '第二句，继续。');
  assert.equal(merged[1][11], 900);
});

test('rejects non-adjacent, cross-role and cross-section merges', () => {
  const rows = [segment(1), segment(2), segment(3)];
  assert.throws(() => mergeAdjacentSegments(rows, [1, 3]), /连续相邻/);
  rows[1][2] = 'narrator';
  assert.throws(() => mergeAdjacentSegments(rows, [1, 2]), /跨角色/);
  rows[1][2] = rows[0][2]; rows[1][1] = '第二章';
  assert.throws(() => mergeAdjacentSegments(rows, [1, 2]), /跨章节/);
});

test('splits one row at a source offset and preserves exact source coverage', () => {
  const rows = [segment(1), segment(2)];
  rows[0][5] = '第一部分，第二部分。'; rows[0][6] = rows[0][5]; rows[0][11] = 800;
  const offset = rows[0][5].indexOf('第', 1);

  const split = splitSegmentAtOffset(rows, 1, offset);

  assert.equal(split.length, 3);
  assert.equal(split[0][5] + split[1][5], rows[0][5]);
  assert.equal(split[0][11], 250);
  assert.equal(split[1][11], 800);
  assert.deepEqual(split.map(row => row[0]), [1, 2, 3]);
});

test('rejects edge and punctuation-only split sides and suggests a punctuation boundary', () => {
  const rows = [segment(1)]; rows[0][5] = '较长的前半句，适合拆开的后半句。';
  assert.throws(() => splitSegmentAtOffset(rows, 1, 0), /有效拆分位置/);
  assert.throws(() => splitSegmentAtOffset(rows, 1, rows[0][5].length - 1), /可朗读文字/);
  assert.equal(suggestSplitOffset(rows[0][5]), rows[0][5].indexOf('，') + 1);
  assert.equal(suggestSplitOffset('😀甲，乙'), 4);
});
