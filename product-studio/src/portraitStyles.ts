export type PortraitStyleKind = 'comic' | 'realistic';

export interface PortraitStylePreset {
  id: string;
  label: string;
  kind: PortraitStyleKind;
  description: string;
}

export const DEFAULT_PORTRAIT_STYLE = 'cinematic_manga';

export const PORTRAIT_STYLE_PRESETS: PortraitStylePreset[] = [
  { id: 'cinematic_manga', label: '电影感漫画', kind: 'comic', description: '清晰轮廓、细腻分层上色、克制综合色彩与电影式光影，适合成熟长篇叙事。' },
  { id: 'clean_cel', label: '清爽赛璐璐', kind: 'comic', description: '利落线稿、纯净色块、轻柔阴影和明快表情，角色辨识度高。' },
  { id: 'soft_watercolor', label: '柔光水彩漫画', kind: 'comic', description: '透明水彩晕染、纸张颗粒、柔和边缘和空气感光线，情绪细腻。' },
  { id: 'noir_ink', label: '黑白悬疑墨线', kind: 'comic', description: '高反差黑白、硬朗墨线、密集排线和深沉阴影，适合犯罪与悬疑。' },
  { id: 'retro_print', label: '复古网点印刷', kind: 'comic', description: '有限色盘、网点层次、套色偏移和纸张质感，带年代印刷气息。' },
  { id: 'neon_scifi', label: '霓虹科幻漫画', kind: 'comic', description: '冷暖霓虹、锐利边缘光、未来材质和夜景氛围，适合科技题材。' },
  { id: 'storybook_gouache', label: '叙事绘本厚涂', kind: 'comic', description: '不透明颜料笔触、温暖综合色调、简洁造型和故事书式构图。' },
  { id: 'oriental_ink', label: '东方水墨漫画', kind: 'comic', description: '墨色浓淡、留白、含蓄设色和流动笔触，强调气韵与人物神态。' },
  { id: 'ornate_fantasy', label: '华丽幻想漫画', kind: 'comic', description: '精致服饰纹样、柔亮材质、层次丰富的装饰和梦幻环境光。' },
  { id: 'urban_sketch', label: '都市速写漫画', kind: 'comic', description: '松弛手绘线条、低饱和街景色彩、自然姿态和生活化构图。' },
  { id: 'pastel_emotion', label: '柔彩情感漫画', kind: 'comic', description: '粉彩综合色调、柔软边缘、轻盈高光和克制表情，适合情感故事。' },
  { id: 'dynamic_action', label: '动态动作漫画', kind: 'comic', description: '有力线条、强透视、方向性光影和紧张构图，保留清晰面部特征。' },
  { id: 'compact_chibi', label: '轻巧 Q 版漫画', kind: 'comic', description: '适度头身简化、圆润造型、清晰表情和干净色块，保留人物标志特征。' },
  { id: 'realistic_photo', label: '真人写实摄影', kind: 'realistic', description: '自然人体比例、真实皮肤与织物质感、摄影棚人像光线和电影级镜头语言。' },
];

export function portraitStylePreset(id?: string): PortraitStylePreset {
  return PORTRAIT_STYLE_PRESETS.find(item => item.id === id)
    ?? PORTRAIT_STYLE_PRESETS.find(item => item.id === DEFAULT_PORTRAIT_STYLE)!;
}
