import type { RoleRow, SegmentRow } from './types';

export type SegmentBulkField = 'role' | 'language' | 'attitude' | 'emotion' | 'pace' | 'pause' | 'emotionDirection' | 'emotionWeight' | 'generationMode';

export interface SegmentBulkEdit {
  field: SegmentBulkField;
  value: string | number;
  emotionDirectionDefaultWeight?: number;
}

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

export function updateSegmentPaceInBulk(
  segments: SegmentRow[],
  pace: string,
  selectedOrders?: number[],
): { segments: SegmentRow[]; targetedCount: number; changedCount: number } {
  const normalizedPace = String(pace || '').trim();
  if (!normalizedPace) throw new Error('请选择要批量应用的分句节奏');
  return updateSegmentsInBulk(segments, [], { field: 'pace', value: normalizedPace }, selectedOrders);
}

export function updateSegmentsInBulk(
  segments: SegmentRow[],
  roles: RoleRow[],
  edit: SegmentBulkEdit,
  selectedOrders?: number[],
): { segments: SegmentRow[]; targetedCount: number; changedCount: number } {
  const selected = selectedOrders === undefined ? undefined : new Set(selectedOrders);
  if (selected && !selected.size) throw new Error('请至少选择一条分句');
  if (selected) {
    const existing = new Set(segments.map(row => row[0]));
    if ([...selected].some(order => !existing.has(order))) throw new Error('所选分句已变化，请重新选择');
  }

  const stringValue = typeof edit.value === 'string' ? edit.value.trim() : '';
  const numericValue = typeof edit.value === 'number' ? edit.value : Number.NaN;
  const columns: Record<Exclude<SegmentBulkField, 'role' | 'emotionDirection'>, number> = {
    language: 4,
    attitude: 7,
    emotion: 8,
    pace: 10,
    pause: 11,
    emotionWeight: 9,
    generationMode: 17,
  };
  if (edit.field === 'role' && !roles.some(role => role[0] === stringValue)) throw new Error('请选择有效角色');
  if (['language', 'attitude', 'emotion', 'pace', 'emotionDirection'].includes(edit.field) && !stringValue) {
    throw new Error('请选择要批量应用的值');
  }
  if (edit.field === 'pause' && (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 3000)) {
    throw new Error('停顿必须在 0 至 3000 毫秒之间');
  }
  if (edit.field === 'emotionWeight' && (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1)) {
    throw new Error('情绪权重必须在 0 至 1 之间');
  }
  if (edit.field === 'generationMode' && !['standard', 'advanced'].includes(stringValue)) {
    throw new Error('请选择有效生成方式');
  }
  if (edit.field === 'emotionDirection' && !['auto', 'custom'].includes(stringValue)
    && (!Number.isFinite(edit.emotionDirectionDefaultWeight) || Number(edit.emotionDirectionDefaultWeight) < 0 || Number(edit.emotionDirectionDefaultWeight) > 1)) {
    throw new Error('所选情绪演绎缺少有效的默认权重');
  }

  let targetedCount = 0;
  let changedCount = 0;
  const updated = segments.map(row => {
    if (selected && !selected.has(row[0])) return row;
    targetedCount += 1;
    const next = [...row] as SegmentRow;
    if (edit.field === 'role') {
      const role = roles.find(candidate => candidate[0] === stringValue)!;
      next[2] = role[0];
      next[3] = role[1];
    } else if (edit.field === 'emotionDirection') {
      next[12] = stringValue;
      if (!['auto', 'custom'].includes(stringValue)) next[9] = Number(edit.emotionDirectionDefaultWeight);
    } else {
      const column = columns[edit.field];
      (next as Array<string | number | undefined>)[column] = ['pause', 'emotionWeight'].includes(edit.field) ? numericValue : stringValue;
    }
    if (next.every((value, index) => value === row[index])) return row;
    changedCount += 1;
    return next;
  });
  return { segments: changedCount ? updated : segments, targetedCount, changedCount };
}

function resequenceSegments(segments: SegmentRow[]): SegmentRow[] {
  return segments.map((row, index) => [index + 1, ...row.slice(1)] as SegmentRow);
}

export function deleteSegmentsByOrder(segments: SegmentRow[], selectedOrders: number[]): SegmentRow[] {
  const selected = new Set(selectedOrders);
  if (!selected.size) throw new Error('请至少选择一条要删除的分句');
  const existingOrders = new Set(segments.map(row => row[0]));
  if ([...selected].some(order => !existingOrders.has(order))) {
    throw new Error('所选分句已变化，请重新选择');
  }
  return resequenceSegments(segments.filter(row => !selected.has(row[0])));
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
