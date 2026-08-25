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
