export const SEGMENT_TABLE_MIN_BODY_HEIGHT = 560;
export const SEGMENT_TABLE_CHROME_HEIGHT = 132;

export function segmentTableBodyHeight(viewportHeight: number, tableTop: number) {
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const visibleTableTop = Number.isFinite(tableTop) ? Math.max(0, tableTop) : 0;
  return Math.max(
    SEGMENT_TABLE_MIN_BODY_HEIGHT,
    Math.floor(safeViewportHeight - visibleTableTop - SEGMENT_TABLE_CHROME_HEIGHT),
  );
}
