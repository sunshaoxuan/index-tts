import type { RenderFragment } from './api';
import type { SegmentRow } from './types';

export function findMatchingFragment(fragments: RenderFragment[] | undefined, segment: SegmentRow): RenderFragment | undefined {
  return fragments?.find(item => item.sourceText === segment[5] && item.synthesisText === segment[6]);
}

export function countMatchingFragments(fragments: RenderFragment[] | undefined, segments: SegmentRow[]): number {
  return segments.filter(segment => Boolean(findMatchingFragment(fragments, segment))).length;
}

export function filterSegmentsWithoutMatchingFragments(fragments: RenderFragment[] | undefined, segments: SegmentRow[]): SegmentRow[] {
  return segments.filter(segment => !findMatchingFragment(fragments, segment));
}
