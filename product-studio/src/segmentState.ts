import type { RoleRow, SegmentRow } from './types';

export function updateSegmentByOrder(
  segments: SegmentRow[],
  roles: RoleRow[],
  order: number,
  column: number,
  value: string | number,
): SegmentRow[] {
  if (column === 2 && !roles.some((role) => role[0] === value)) return segments;

  let found = false;
  const updatedSegments = segments.map((row) => {
    if (row[0] !== order) return row;
    found = true;
    const updated = row.map((cell, index) => index === column ? value : cell) as SegmentRow;
    if (column === 2) updated[3] = roles.find((role) => role[0] === value)![1];
    return updated;
  });
  return found ? updatedSegments : segments;
}

function resequenceSegments(segments: SegmentRow[]): SegmentRow[] {
  return segments.map((row, index) => [index + 1, ...row.slice(1)] as SegmentRow);
}

export function mergeAdjacentSegments(segments: SegmentRow[], selectedOrders: number[]): SegmentRow[] {
  const selected = [...new Set(selectedOrders)].sort((a, b) => a - b);
  if (selected.length < 2) throw new Error('请至少选择两条相邻分句');
  const indices = selected.map(order => segments.findIndex(row => row[0] === order));
  if (indices.some(index => index < 0)) throw new Error('所选分句已变化，请重新选择');
  if (indices.some((index, position) => position > 0 && index !== indices[position - 1] + 1)) {
    throw new Error('只能合并连续相邻的分句');
  }
  const rows = indices.map(index => segments[index]);
  if (rows.some(row => row[1] !== rows[0][1])) throw new Error('跨章节分句不能直接合并');
  if (rows.some(row => row[2] !== rows[0][2])) throw new Error('跨角色分句不能直接合并，请先统一角色');
  if (rows.some(row => row[4] !== rows[0][4])) throw new Error('不同语言的分句不能直接合并');

  const first = [...rows[0]] as SegmentRow;
  const last = rows[rows.length - 1];
  first[5] = rows.map(row => String(row[5])).join('');
  first[6] = rows.map(row => String(row[6])).join('');
  first[11] = last[11];
  const selectedSet = new Set(selected);
  const updated = segments.flatMap(row => row[0] === first[0] ? [first] : selectedSet.has(row[0]) ? [] : [row]);
  return resequenceSegments(updated);
}

export function splitSegmentAtOffset(segments: SegmentRow[], order: number, sourceOffset: number): SegmentRow[] {
  const index = segments.findIndex(row => row[0] === order);
  if (index < 0) throw new Error('所选分句已变化，请重新选择');
  const row = segments[index];
  const source = String(row[5]);
  if (!Number.isInteger(sourceOffset) || sourceOffset <= 0 || sourceOffset >= source.length) {
    throw new Error('请选择原文中间的有效拆分位置');
  }
  const beforeSource = source.slice(0, sourceOffset);
  const afterSource = source.slice(sourceOffset);
  if (![beforeSource, afterSource].every(value => [...value].some(character => /[\p{L}\p{N}]/u.test(character)))) {
    throw new Error('拆分位置两侧都必须包含可朗读文字');
  }
  const before = [...row] as SegmentRow;
  const after = [...row] as SegmentRow;
  before[5] = beforeSource;
  before[6] = beforeSource.trim();
  before[11] = 250;
  after[5] = afterSource;
  after[6] = afterSource.trim();
  const updated = [...segments.slice(0, index), before, after, ...segments.slice(index + 1)];
  return resequenceSegments(updated);
}

export function suggestSplitOffset(source: string): number {
  if (source.length < 2) return 0;
  const midpoint = Math.floor(source.length / 2);
  const candidates = [...source.matchAll(/[，。！？；,.!?;\s]/gu)]
    .map(match => (match.index ?? 0) + match[0].length)
    .filter(index => index > 0 && index < source.length);
  return candidates.sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint))[0] ?? midpoint;
}
