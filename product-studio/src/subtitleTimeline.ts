import type { RenderCaption } from './api.ts';

export interface TimedCaption extends RenderCaption {
  startSeconds: number;
  endSeconds: number;
}

export function buildCaptionTimeline(captions: RenderCaption[] = []): TimedCaption[] {
  let cursor = 0;
  return captions.map((caption) => {
    const durationSeconds = Number.isFinite(caption.durationSeconds) ? Math.max(0, caption.durationSeconds) : 0;
    const pauseAfterMs = Number.isFinite(caption.pauseAfterMs) ? Math.max(0, caption.pauseAfterMs) : 0;
    const timed = { ...caption, durationSeconds, pauseAfterMs, startSeconds: cursor, endSeconds: cursor + durationSeconds + pauseAfterMs / 1000 };
    cursor = timed.endSeconds;
    return timed;
  });
}

export function activeCaptionIndex(timeline: TimedCaption[], currentSeconds: number): number {
  if (!timeline.length) return -1;
  const safeCurrent = Number.isFinite(currentSeconds) ? Math.max(0, currentSeconds) : 0;
  const index = timeline.findIndex(caption => safeCurrent < caption.endSeconds);
  return index >= 0 ? index : timeline.length - 1;
}
