export const SEGMENT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

export function clampSegmentPage(current: number, total: number, pageSize: number) {
  const safePageSize = Math.max(1, Math.trunc(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(Math.max(0, total) / safePageSize));
  return Math.min(pageCount, Math.max(1, Math.trunc(current) || 1));
}
