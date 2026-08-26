import type { CharacterAsset, CharacterGender, RoleRow } from './types';

export interface PitchRecommendation {
  min: number;
  max: number;
  target: number;
  label: string;
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
  else if (safeAge < 20) [min, max] = gender === 'male' ? [120, 220] : gender === 'female' ? [175, 285] : [120, 285];
  else if (safeAge < 60) [min, max] = gender === 'male' ? [85, 180] : gender === 'female' ? [165, 255] : [90, 270];
  else [min, max] = gender === 'male' ? [75, 165] : gender === 'female' ? [135, 235] : [80, 250];
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
  return {
    gender,
    age,
    pitch_min_hz: min,
    pitch_max_hz: max,
    pitch_target_hz: target,
    portrait_url: input?.portrait_url,
    portrait_prompt: input?.portrait_prompt,
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
  };
}
