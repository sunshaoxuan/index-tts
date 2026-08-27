import type { CharacterAsset, CharacterGender, RoleRow } from './types';
import { DEFAULT_AUDITION_TEXT, normalizeVoiceGeneration, normalizeVoiceTraits, recommendedVoiceTraits } from './voiceControls.ts';

const DEFAULT_PORTRAIT_STYLE = 'cinematic_manga';
const PORTRAIT_STYLE_IDS = new Set([
  'cinematic_manga', 'clean_cel', 'soft_watercolor', 'noir_ink', 'retro_print', 'neon_scifi',
  'storybook_gouache', 'oriental_ink', 'ornate_fantasy', 'urban_sketch', 'pastel_emotion',
  'dynamic_action', 'compact_chibi', 'realistic_photo',
]);

export interface PitchRecommendation {
  min: number;
  max: number;
  target: number;
  label: string;
}

export function ageVoiceConstraint(age: number): string {
  const safeAge = Math.max(5, Math.min(100, Math.round(Number(age) || 35)));
  if (safeAge < 13) return '年龄听感强约束：尚未变声的儿童声线，基频明显高于成年人，发声轻巧自然，保留儿童口腔共鸣、清亮度和稚嫩感；成年男性低音、胸腔厚重共鸣或成熟声带质感均不合格。';
  if (safeAge < 20) return '年龄听感强约束：青少年声线，保持较轻的声带质感和自然明亮度，禁止明显中老年化粗粝声线。';
  if (safeAge < 40) return '年龄听感强约束：青年到壮年声线，声带闭合自然，共鸣清晰，避免儿童感或明显衰老感。';
  if (safeAge < 50) return '年龄听感强约束：成熟中年声线，声带质感稳实，共鸣位置适中，减少轻薄和少年感。';
  if (safeAge < 70) return '年龄听感强约束：成熟偏老年声线，声带厚度明显，共鸣位置靠下，高频亮度受控，允许轻微自然粗粝和松弛感，禁止明亮、轻薄、紧致的青年声线。';
  return '年龄听感强约束：老年声线，声带质感厚而略松，共鸣靠下，高频亮度克制，带自然气息感和轻微粗粝感，禁止青年化清亮紧致声线。';
}

export function inferCharacterGender(...sources: string[]): CharacterGender {
  const femaleTerms = ['女性', '女声', '女人', '妇人', '妻子', '母亲', '奶奶', '姐姐', '妹妹', '女儿', '少女', '女孩'];
  const maleTerms = ['男性', '男声', '男人', '丈夫', '父亲', '爷爷', '哥哥', '弟弟', '儿子', '少年', '男孩'];
  for (const source of sources) {
    const female = femaleTerms.some(term => source.includes(term));
    const male = maleTerms.some(term => source.includes(term));
    if (female !== male) return female ? 'female' : 'male';
  }
  return 'unspecified';
}

export function recommendPitchRange(gender: CharacterGender, age: number): PitchRecommendation {
  const safeAge = Math.max(5, Math.min(100, Number.isFinite(age) ? Math.round(age) : 35));
  let min: number;
  let max: number;
  if (safeAge < 13) [min, max] = gender === 'male' ? [190, 320] : gender === 'female' ? [210, 340] : [190, 340];
  else if (safeAge < 20) [min, max] = gender === 'male' ? [120, 220] : gender === 'female' ? [185, 295] : [120, 295];
  else if (safeAge < 60) [min, max] = gender === 'male' ? [85, 180] : gender === 'female' ? [180, 280] : [90, 280];
  else [min, max] = gender === 'male' ? [75, 165] : gender === 'female' ? [155, 250] : [80, 250];
  const target = Math.round((min + max) / 2);
  const genderLabel = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '未指定性别';
  return { min, max, target, label: `${safeAge} 岁${genderLabel}建议 ${min} 至 ${max} Hz` };
}

export function normalizeCharacterAsset(role: RoleRow, input?: Partial<CharacterAsset>): CharacterAsset {
  const gender = input?.gender ?? inferCharacterGender(role[4], role[3], role[1]);
  const age = Math.max(5, Math.min(100, Math.round(Number(input?.age) || 35)));
  const recommendation = recommendPitchRange(gender, age);
  const min = Number.isFinite(input?.pitch_min_hz) ? Number(input?.pitch_min_hz) : recommendation.min;
  const max = Number.isFinite(input?.pitch_max_hz) ? Number(input?.pitch_max_hz) : recommendation.max;
  const requested = Number(input?.pitch_target_hz);
  const target = Number.isFinite(requested) ? Math.max(min, Math.min(max, Math.round(requested))) : recommendation.target;
  const requestedPortraitStyle = input?.portrait_style || '';
  return {
    gender,
    age,
    pitch_min_hz: min,
    pitch_max_hz: max,
    pitch_target_hz: target,
    audition_text: String(input?.audition_text || DEFAULT_AUDITION_TEXT).trim().slice(0, 500) || DEFAULT_AUDITION_TEXT,
    voice_traits: normalizeVoiceTraits(input?.voice_traits ?? recommendedVoiceTraits(age)),
    voice_generation: normalizeVoiceGeneration(input?.voice_generation),
    voice_candidates: Array.isArray(input?.voice_candidates) ? input.voice_candidates.filter(item => item?.voice_id).slice(0, 6) : undefined,
    portrait_url: input?.portrait_url,
    portrait_prompt: input?.portrait_prompt,
    portrait_style: PORTRAIT_STYLE_IDS.has(requestedPortraitStyle) ? requestedPortraitStyle : DEFAULT_PORTRAIT_STYLE,
    portrait_notes: input?.portrait_notes,
    profile_updated_by: input?.profile_updated_by,
  };
}

export function updateAssetDemographics(asset: CharacterAsset, gender: CharacterGender, age: number): CharacterAsset {
  const recommendation = recommendPitchRange(gender, age);
  return {
    ...asset,
    gender,
    age: Math.max(5, Math.min(100, Math.round(age))),
    pitch_min_hz: recommendation.min,
    pitch_max_hz: recommendation.max,
    pitch_target_hz: recommendation.target,
    voice_traits: recommendedVoiceTraits(age),
  };
}
