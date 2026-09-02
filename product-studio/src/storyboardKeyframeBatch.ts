export type StoryboardKeyframeBatchMode = 'single' | 'all';
export type StoryboardKeyframeBatchPhase = 'preflight' | 'generating' | 'complete' | 'cancelled' | 'error';

export interface StoryboardKeyframeQueueItem {
  sceneId: string;
  shotId: string;
  title: string;
  shot: Record<string, unknown>;
}

export interface StoryboardKeyframeBatchProgress {
  mode: StoryboardKeyframeBatchMode;
  phase: StoryboardKeyframeBatchPhase;
  total: number;
  completed: number;
  currentIndex?: number;
  currentShotId?: string;
  currentTitle?: string;
  startedAt: number;
  updatedAt: number;
  errorMessage?: string;
}

export function buildStoryboardKeyframeQueue(scenes: Array<Record<string, unknown>>): StoryboardKeyframeQueueItem[] {
  return scenes.flatMap(scene => {
    const sceneId = String(scene.id || '');
    return ((Array.isArray(scene.shots) ? scene.shots : []) as Array<Record<string, unknown>>).map((shot, index) => ({
      sceneId,
      shotId: String(shot.id || `${sceneId}_shot_${index + 1}`),
      title: String(shot.title || `镜头 ${index + 1}`),
      shot,
    }));
  });
}

export function storyboardKeyframeProgressPercent(progress?: StoryboardKeyframeBatchProgress): number {
  if (!progress || progress.total <= 0) return 0;
  if (progress.phase === 'complete') return 100;
  return Math.max(0, Math.min(99, Math.round((progress.completed / progress.total) * 100)));
}

export function storyboardKeyframeRemainingSeconds(progress?: StoryboardKeyframeBatchProgress): number | undefined {
  if (!progress || progress.completed <= 0 || progress.completed >= progress.total) return undefined;
  const elapsedSeconds = Math.max(0, (progress.updatedAt - progress.startedAt) / 1000);
  if (!elapsedSeconds) return undefined;
  return Math.max(1, Math.round((elapsedSeconds / progress.completed) * (progress.total - progress.completed)));
}

export async function runStoryboardKeyframeBatch<T>({
  items,
  mode = 'all',
  preflight,
  generate,
  onGenerated,
  onProgress,
  signal,
  now = Date.now,
}: {
  items: StoryboardKeyframeQueueItem[];
  mode?: StoryboardKeyframeBatchMode;
  preflight: () => Promise<unknown>;
  generate: (item: StoryboardKeyframeQueueItem, index: number) => Promise<T>;
  onGenerated: (item: StoryboardKeyframeQueueItem, result: T, index: number) => void;
  onProgress: (progress: StoryboardKeyframeBatchProgress) => void;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<T[]> {
  if (!items.length) throw new Error('当前工程没有可生成的分镜镜头');
  const startedAt = now();
  let completed = 0;
  let currentIndex: number | undefined;
  let currentItem: StoryboardKeyframeQueueItem | undefined;
  onProgress({ mode, phase: 'preflight', total: items.length, completed, startedAt, updatedAt: startedAt });
  try {
    signal?.throwIfAborted();
    await preflight();
    const results: T[] = [];
    for (let index = 0; index < items.length; index += 1) {
      signal?.throwIfAborted();
      currentIndex = index + 1;
      currentItem = items[index];
      onProgress({ mode, phase: 'generating', total: items.length, completed, currentIndex, currentShotId: currentItem.shotId, currentTitle: currentItem.title, startedAt, updatedAt: now() });
      const result = await generate(currentItem, index);
      results.push(result);
      onGenerated(currentItem, result, index);
      completed = index + 1;
      onProgress({ mode, phase: 'generating', total: items.length, completed, currentIndex, currentShotId: currentItem.shotId, currentTitle: currentItem.title, startedAt, updatedAt: now() });
    }
    onProgress({ mode, phase: 'complete', total: items.length, completed, startedAt, updatedAt: now() });
    return results;
  } catch (error) {
    const cancelled = signal?.aborted || (error instanceof Error && error.name === 'AbortError');
    onProgress({
      mode,
      phase: cancelled ? 'cancelled' : 'error',
      total: items.length,
      completed,
      currentIndex,
      currentShotId: currentItem?.shotId,
      currentTitle: currentItem?.title,
      startedAt,
      updatedAt: now(),
      errorMessage: cancelled ? '用户已取消关键帧生成' : error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
