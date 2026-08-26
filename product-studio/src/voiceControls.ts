import type { VoiceGenerationPreset, VoiceGenerationSettings, VoiceTraits } from './types';

export const DEFAULT_AUDITION_TEXT = '这是我的声音。我会用清晰自然的方式，陪你走进这个故事。';

export const DEFAULT_VOICE_TRAITS: VoiceTraits = Object.freeze({
  weight: 50,
  brightness: 50,
  resonance: 35,
  tension: 50,
  roughness: 15,
  breathiness: 15,
  nasality: 10,
  articulation: 65,
  pace: 50,
  pause_density: 45,
  pitch_variation: 45,
  expressiveness: 50,
  accent: '',
});

export function recommendedVoiceTraits(age: number): VoiceTraits {
  const safeAge = Math.max(5, Math.min(100, Math.round(Number(age) || 35)));
  if (safeAge < 13) return { ...DEFAULT_VOICE_TRAITS, weight: 20, brightness: 75, resonance: 72, tension: 58, roughness: 5, breathiness: 12, articulation: 58, pace: 58, pause_density: 38, pitch_variation: 68, expressiveness: 62 };
  if (safeAge < 20) return { ...DEFAULT_VOICE_TRAITS, weight: 32, brightness: 66, resonance: 58, tension: 58, roughness: 8, breathiness: 12, pace: 56, pitch_variation: 58, expressiveness: 58 };
  if (safeAge < 50) return { ...DEFAULT_VOICE_TRAITS };
  if (safeAge < 70) return { ...DEFAULT_VOICE_TRAITS, weight: 68, brightness: 35, resonance: 22, tension: 40, roughness: 38, breathiness: 28, articulation: 62, pace: 38, pause_density: 62, pitch_variation: 36, expressiveness: 42 };
  return { ...DEFAULT_VOICE_TRAITS, weight: 75, brightness: 25, resonance: 16, tension: 28, roughness: 52, breathiness: 42, articulation: 55, pace: 30, pause_density: 72, pitch_variation: 30, expressiveness: 38 };
}

export const VOICE_GENERATION_PRESETS: Record<Exclude<VoiceGenerationPreset, 'custom'>, Omit<VoiceGenerationSettings, 'preset' | 'seed' | 'candidate_count' | 'max_new_tokens'>> = Object.freeze({
  stable: { do_sample: true, top_k: 30, top_p: 0.85, temperature: 0.65, repetition_penalty: 1.08, subtalker_dosample: true, subtalker_top_k: 30, subtalker_top_p: 0.85, subtalker_temperature: 0.65 },
  balanced: { do_sample: true, top_k: 50, top_p: 0.95, temperature: 0.85, repetition_penalty: 1.05, subtalker_dosample: true, subtalker_top_k: 50, subtalker_top_p: 0.95, subtalker_temperature: 0.85 },
  explore: { do_sample: true, top_k: 100, top_p: 1, temperature: 1.1, repetition_penalty: 1.03, subtalker_dosample: true, subtalker_top_k: 100, subtalker_top_p: 1, subtalker_temperature: 1.1 },
});

export const DEFAULT_VOICE_GENERATION: VoiceGenerationSettings = Object.freeze({
  preset: 'balanced',
  ...VOICE_GENERATION_PRESETS.balanced,
  seed: 42,
  max_new_tokens: 2048,
  candidate_count: 3,
});

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function normalizeVoiceTraits(input?: Partial<VoiceTraits>): VoiceTraits {
  return {
    weight: clamp(input?.weight, 0, 100, DEFAULT_VOICE_TRAITS.weight),
    brightness: clamp(input?.brightness, 0, 100, DEFAULT_VOICE_TRAITS.brightness),
    resonance: clamp(input?.resonance, 0, 100, DEFAULT_VOICE_TRAITS.resonance),
    tension: clamp(input?.tension, 0, 100, DEFAULT_VOICE_TRAITS.tension),
    roughness: clamp(input?.roughness, 0, 100, DEFAULT_VOICE_TRAITS.roughness),
    breathiness: clamp(input?.breathiness, 0, 100, DEFAULT_VOICE_TRAITS.breathiness),
    nasality: clamp(input?.nasality, 0, 100, DEFAULT_VOICE_TRAITS.nasality),
    articulation: clamp(input?.articulation, 0, 100, DEFAULT_VOICE_TRAITS.articulation),
    pace: clamp(input?.pace, 0, 100, DEFAULT_VOICE_TRAITS.pace),
    pause_density: clamp(input?.pause_density, 0, 100, DEFAULT_VOICE_TRAITS.pause_density),
    pitch_variation: clamp(input?.pitch_variation, 0, 100, DEFAULT_VOICE_TRAITS.pitch_variation),
    expressiveness: clamp(input?.expressiveness, 0, 100, DEFAULT_VOICE_TRAITS.expressiveness),
    accent: String(input?.accent || '').trim().slice(0, 120),
  };
}

export function normalizeVoiceGeneration(input?: Partial<VoiceGenerationSettings>): VoiceGenerationSettings {
  const requested = ['stable', 'balanced', 'explore', 'custom'].includes(String(input?.preset)) ? input?.preset as VoiceGenerationPreset : 'balanced';
  const presetValues = requested === 'custom' ? DEFAULT_VOICE_GENERATION : VOICE_GENERATION_PRESETS[requested];
  return {
    preset: requested,
    do_sample: input?.do_sample ?? presetValues.do_sample,
    top_k: Math.round(clamp(input?.top_k, 1, 200, presetValues.top_k)),
    top_p: clamp(input?.top_p, 0.05, 1, presetValues.top_p),
    temperature: clamp(input?.temperature, 0.1, 2, presetValues.temperature),
    repetition_penalty: clamp(input?.repetition_penalty, 1, 2, presetValues.repetition_penalty),
    seed: Math.round(clamp(input?.seed, 0, 2147483647, 42)),
    max_new_tokens: Math.round(clamp(input?.max_new_tokens, 256, 8192, 2048)),
    candidate_count: Math.round(clamp(input?.candidate_count, 1, 6, 3)),
    subtalker_dosample: input?.subtalker_dosample ?? presetValues.subtalker_dosample,
    subtalker_top_k: Math.round(clamp(input?.subtalker_top_k, 1, 200, presetValues.subtalker_top_k)),
    subtalker_top_p: clamp(input?.subtalker_top_p, 0.05, 1, presetValues.subtalker_top_p),
    subtalker_temperature: clamp(input?.subtalker_temperature, 0.1, 2, presetValues.subtalker_temperature),
  };
}

export function applyVoiceGenerationPreset(current: VoiceGenerationSettings, preset: VoiceGenerationPreset): VoiceGenerationSettings {
  if (preset === 'custom') return { ...current, preset };
  return { ...current, ...VOICE_GENERATION_PRESETS[preset], preset };
}

function scale(value: number, low: string, midLow: string, middle: string, midHigh: string, high: string) {
  if (value < 20) return low;
  if (value < 40) return midLow;
  if (value < 60) return middle;
  if (value < 80) return midHigh;
  return high;
}

export function voiceTraitsInstruction(traits: VoiceTraits): string {
  const normalized = normalizeVoiceTraits(traits);
  const parts = [
    `声音重量${scale(normalized.weight, '非常轻薄', '偏轻', '适中', '偏厚', '非常厚重')}`,
    `音色亮度${scale(normalized.brightness, '非常暗沉', '偏暗', '自然平衡', '偏明亮', '非常明亮')}`,
    `共鸣位置${scale(normalized.resonance, '以胸腔共鸣为主', '胸腔与口腔之间', '以口腔共鸣为主', '口腔与头腔之间', '以头腔共鸣为主')}`,
    `声带状态${scale(normalized.tension, '明显松弛', '偏松', '自然闭合', '偏紧致', '非常紧致')}`,
    `粗糙度${scale(normalized.roughness, '纯净平滑', '轻微纹理', '自然颗粒感', '明显粗粝', '强烈粗粝沙哑')}`,
    `气息量${scale(normalized.breathiness, '紧实少气声', '轻微气息', '自然气息', '明显气声', '大量气声')}`,
    `鼻音${scale(normalized.nasality, '基本无鼻音', '轻微鼻音', '自然鼻腔参与', '明显鼻音', '强鼻音')}`,
    `吐字${scale(normalized.articulation, '非常柔和含混', '偏柔和', '自然清晰', '清晰锋利', '极其锐利清楚')}`,
    `语速${scale(normalized.pace, '非常缓慢', '偏慢', '自然', '偏快', '非常快')}`,
    `停顿${scale(normalized.pause_density, '非常稀少', '偏少', '自然', '偏多', '非常密集')}`,
    `音高起伏${scale(normalized.pitch_variation, '近乎平直', '偏平稳', '自然', '较丰富', '非常丰富')}`,
    `情绪外放${scale(normalized.expressiveness, '极度克制', '偏克制', '自然', '较外放', '非常外放')}`,
  ];
  if (normalized.accent) parts.push(`地域或口音要求：${normalized.accent}`);
  return `结构化声音特征：${parts.join('；')}。`;
}
