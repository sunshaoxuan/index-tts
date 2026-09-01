import type { RenderCaption } from './api.ts';
import { buildCaptionTimeline } from './subtitleTimeline.ts';

export type StoryboardStyleKind = 'illustrated' | 'realistic';

export interface StoryboardStylePreset {
  id: string;
  label: string;
  kind: StoryboardStyleKind;
  description: string;
}

export interface SceneAudioRange {
  startSeconds: number;
  endSeconds: number;
  startOrder: number;
  endOrder: number;
}

export const DEFAULT_STORYBOARD_STYLE = 'cinematic_manga';

export const STORYBOARD_STYLE_PRESETS: StoryboardStylePreset[] = [
  { id: 'cinematic_manga', label: '电影感漫画', kind: 'illustrated', description: '成熟漫画造型、分层上色和电影式光影，适合连续叙事。' },
  { id: 'clean_cel', label: '清爽赛璐璐', kind: 'illustrated', description: '清晰线稿、纯净色块和明确动作轮廓。' },
  { id: 'soft_watercolor', label: '柔光水彩', kind: 'illustrated', description: '水彩晕染、空气感光线和细腻情绪。' },
  { id: 'noir_ink', label: '黑白悬疑墨线', kind: 'illustrated', description: '高反差墨线、深沉阴影和紧张构图。' },
  { id: 'retro_print', label: '复古网点印刷', kind: 'illustrated', description: '有限色盘、网点层次和年代印刷质感。' },
  { id: 'neon_scifi', label: '霓虹科幻', kind: 'illustrated', description: '冷暖霓虹、未来材质和锐利边缘光。' },
  { id: 'storybook_gouache', label: '叙事绘本厚涂', kind: 'illustrated', description: '不透明笔触、温暖综合色调和故事书构图。' },
  { id: 'oriental_ink', label: '东方水墨', kind: 'illustrated', description: '墨色浓淡、留白和含蓄设色。' },
  { id: 'cinematic_realistic', label: '电影写实', kind: 'realistic', description: '真实人物与环境材质、电影摄影光线和自然镜头景深。' },
];

export function storyboardStylePreset(id?: string): StoryboardStylePreset {
  return STORYBOARD_STYLE_PRESETS.find(item => item.id === id)
    ?? STORYBOARD_STYLE_PRESETS.find(item => item.id === DEFAULT_STORYBOARD_STYLE)!;
}

export function buildSceneAudioRanges(
  documentSegments: Array<Record<string, unknown>> = [],
  captions: RenderCaption[] = [],
): Record<string, SceneAudioRange> {
  if (!captions.length) return {};
  const sceneByOrder = new Map<number, string>();
  for (const segment of documentSegments) {
    const order = Number(segment.order);
    const sceneId = String(segment.scene_id || '').trim();
    if (Number.isInteger(order) && order > 0 && sceneId) sceneByOrder.set(order, sceneId);
  }
  const ranges: Record<string, SceneAudioRange> = {};
  for (const caption of buildCaptionTimeline(captions)) {
    const sceneId = sceneByOrder.get(Number(caption.order));
    if (!sceneId) continue;
    const existing = ranges[sceneId];
    ranges[sceneId] = existing ? {
      startSeconds: Math.min(existing.startSeconds, caption.startSeconds),
      endSeconds: Math.max(existing.endSeconds, caption.endSeconds),
      startOrder: Math.min(existing.startOrder, caption.order),
      endOrder: Math.max(existing.endOrder, caption.order),
    } : {
      startSeconds: caption.startSeconds,
      endSeconds: caption.endSeconds,
      startOrder: caption.order,
      endOrder: caption.order,
    };
  }
  return ranges;
}

export function formatStoryboardTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}
