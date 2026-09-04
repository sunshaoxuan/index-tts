import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPendingJobs, jobModelKey } from './model-job-scheduler.mjs';
import { assignNumberedChapterSections, splitChapters } from './chapterSections.mjs';
import { adaptImagePrompt, compatibleServiceError, imageModelCandidates, runWithImageModelFallback } from './image-model-routing.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(here, '..', '..');

export const presets = {
  voiceStyles: ['中性清晰', '低沉厚实', '温和亲切', '清亮年轻', '冷静克制', '紧张警觉', '悲伤低落', '威严有力', '沙哑沧桑', '轻快活泼'],
  voiceStylePrompts: {
    中性清晰: '中性、清晰、自然，吐字准确', 低沉厚实: '低沉厚实，声音有支撑，气息稳定', 温和亲切: '温和亲切，声线柔和，交流感自然',
    清亮年轻: '清亮年轻，声音通透，富有朝气', 冷静克制: '冷静克制，情绪内收，表达理性', 紧张警觉: '紧张警觉，声音收紧，保持清晰',
    悲伤低落: '悲伤低落，声音低回，情绪含蓄', 威严有力: '威严有力，声音坚实，表达明确', 沙哑沧桑: '略带沙哑和沧桑感，气息自然',
    轻快活泼: '轻快活泼，声音明亮，富有活力',
  },
  rhythms: ['自然叙述', '沉稳舒缓', '紧凑清晰', '轻快活泼', '克制停连', '低声内敛', '威严有力'],
  rhythmPrompts: {
    自然叙述: '自然表达，按语义停连', 沉稳舒缓: '沉稳舒缓，重音清晰，短语间自然停连', 紧凑清晰: '紧凑表达，声母清晰，保持自然换气',
    轻快活泼: '轻快灵动，声母清楚，短句间自然换气', 克制停连: '克制表达，短语边界清楚，停连分明', 低声内敛: '低声内敛，韵母轻收，短语间自然停连',
    威严有力: '坚定有力，重音明确，停顿干脆',
  },
  attitudes: ['中性叙述', '沉稳叙述', '温和交流', '紧张警觉', '克制低沉', '悲伤压抑', '喜悦明快', '愤怒强烈', '恐惧迟疑', '威严命令'],
  emotions: ['喜悦', '愤怒', '悲伤', '恐惧', '厌恶', '低落', '惊喜', '平静'],
  emotionDirections: [
    { value: 'auto', label: '跟随基础情绪', prompt: '', defaultWeight: 0.6 },
    { value: 'sly_smile', label: '坏笑着说', prompt: 'speaking with a sly mischievous smile, slightly teasing and amused', defaultWeight: 0.8 },
    { value: 'urgent_question', label: '急切地问', prompt: 'urgent and impatient, asking quickly and eagerly, fast-paced speech with strong questioning intonation', defaultWeight: 0.85 },
    { value: 'inner_thought', label: '暗自思忖', prompt: 'quiet internal monologue, thinking to oneself, contemplative and suspicious, subdued voice with slight hesitation', defaultWeight: 0.7 },
    { value: 'cold_statement', label: '冷冷地说', prompt: 'cold and restrained, emotionally distant, speaking slowly with a firm controlled tone', defaultWeight: 0.7 },
    { value: 'hushed_warning', label: '压低声音警告', prompt: 'lowered voice, tense and cautionary, delivering a controlled warning with deliberate emphasis', defaultWeight: 0.8 },
    { value: 'restrained_sadness', label: '强忍悲伤', prompt: 'holding back grief, subdued and fragile, restrained sorrow with slight breathiness', defaultWeight: 0.75 },
    { value: 'angry_interrogation', label: '愤怒质问', prompt: 'angry and confrontational questioning, forceful emphasis, rising intensity and sharp interrogative intonation', defaultWeight: 0.9 },
    { value: 'fearful_whisper', label: '惊恐低语', prompt: 'fearful whisper, tense breathing, hesitant and alarmed while keeping the voice low', defaultWeight: 0.8 },
    { value: 'gentle_comfort', label: '温柔安慰', prompt: 'gentle and reassuring, warm compassionate tone, calm pacing with soft supportive emphasis', defaultWeight: 0.65 },
    { value: 'excited_announcement', label: '兴奋宣布', prompt: 'excited and energetic announcement, bright tone, lively pacing and clear enthusiastic emphasis', defaultWeight: 0.8 },
    { value: 'custom', label: '自定义描述', prompt: '', defaultWeight: 0.7 },
  ],
  paces: ['自然', '舒缓', '紧凑', '轻快', '克制', '低声', '强调'],
  roleKinds: ['narrator', 'character', 'anchor', 'reporter', 'interviewee'],
  roleKindLabels: { narrator: '旁白', character: '人物', anchor: '新闻主播', reporter: '记者', interviewee: '采访对象' },
  contentTypeLabels: { auto: '自动识别', novel: '小说', news: '新闻', commentary: '一般评论', story: '故事体' },
  languages: ['ZH', 'EN', 'JA', 'ES', 'AR'],
};

function defaultRoleProfile(name, kind) {
  if (kind === 'narrator') return '全篇叙事视角，负责环境、动作、心理活动与说话归属；不对应具体人物，声音需要在章节之间保持稳定。';
  const label = presets.roleKindLabels[kind] || '人物';
  return `${name}是原文中已识别的${label}。当前文本证据尚不足以确定年龄、身份、人物关系、性格和经历，请结合全文补充后再生成音色。`;
}

function inferCharacterGender(...sources) {
  const femaleTerms = ['女性', '女声', '女人', '妇人', '妻子', '母亲', '奶奶', '姐姐', '妹妹', '女儿', '少女', '女孩'];
  const maleTerms = ['男性', '男声', '男人', '丈夫', '父亲', '爷爷', '哥哥', '弟弟', '儿子', '少年', '男孩'];
  for (const source of sources.map(value => String(value || ''))) {
    const female = femaleTerms.some(term => source.includes(term));
    const male = maleTerms.some(term => source.includes(term));
    if (female !== male) return female ? 'female' : 'male';
  }
  return 'unspecified';
}

export function recommendPitchRange(gender, age) {
  const safeAge = Math.max(5, Math.min(100, Math.round(Number(age) || 35)));
  let min;
  let max;
  if (safeAge < 13) [min, max] = gender === 'male' ? [190, 320] : gender === 'female' ? [210, 340] : [190, 340];
  else if (safeAge < 20) [min, max] = gender === 'male' ? [120, 220] : gender === 'female' ? [185, 295] : [120, 295];
  else if (safeAge < 60) [min, max] = gender === 'male' ? [85, 180] : gender === 'female' ? [180, 280] : [90, 280];
  else [min, max] = gender === 'male' ? [75, 165] : gender === 'female' ? [155, 250] : [80, 250];
  return { min, max, target: Math.round((min + max) / 2) };
}

const DEFAULT_AUDITION_TEXT = '这是我的声音。我会用清晰自然的方式，陪你走进这个故事。';
const DEFAULT_VOICE_TRAITS = Object.freeze({ weight: 50, brightness: 50, resonance: 35, tension: 50, roughness: 15, breathiness: 15, nasality: 10, articulation: 65, pace: 50, pause_density: 45, pitch_variation: 45, expressiveness: 50, accent: '' });
const VOICE_GENERATION_PRESETS = Object.freeze({
  stable: { do_sample: true, top_k: 30, top_p: 0.85, temperature: 0.65, repetition_penalty: 1.08, subtalker_dosample: true, subtalker_top_k: 30, subtalker_top_p: 0.85, subtalker_temperature: 0.65 },
  balanced: { do_sample: true, top_k: 50, top_p: 0.95, temperature: 0.85, repetition_penalty: 1.05, subtalker_dosample: true, subtalker_top_k: 50, subtalker_top_p: 0.95, subtalker_temperature: 0.85 },
  explore: { do_sample: true, top_k: 100, top_p: 1, temperature: 1.1, repetition_penalty: 1.03, subtalker_dosample: true, subtalker_top_k: 100, subtalker_top_p: 1, subtalker_temperature: 1.1 },
});
const DEFAULT_VOICE_GENERATION = Object.freeze({ preset: 'balanced', ...VOICE_GENERATION_PRESETS.balanced, seed: 42, max_new_tokens: 2048, candidate_count: 3 });

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function recommendedVoiceTraits(age) {
  const safeAge = Math.max(5, Math.min(100, Math.round(Number(age) || 35)));
  if (safeAge < 13) return { ...DEFAULT_VOICE_TRAITS, weight: 20, brightness: 75, resonance: 72, tension: 58, roughness: 5, breathiness: 12, articulation: 58, pace: 58, pause_density: 38, pitch_variation: 68, expressiveness: 62 };
  if (safeAge < 20) return { ...DEFAULT_VOICE_TRAITS, weight: 32, brightness: 66, resonance: 58, tension: 58, roughness: 8, breathiness: 12, pace: 56, pitch_variation: 58, expressiveness: 58 };
  if (safeAge < 50) return { ...DEFAULT_VOICE_TRAITS };
  if (safeAge < 70) return { ...DEFAULT_VOICE_TRAITS, weight: 68, brightness: 35, resonance: 22, tension: 40, roughness: 38, breathiness: 28, articulation: 62, pace: 38, pause_density: 62, pitch_variation: 36, expressiveness: 42 };
  return { ...DEFAULT_VOICE_TRAITS, weight: 75, brightness: 25, resonance: 16, tension: 28, roughness: 52, breathiness: 42, articulation: 55, pace: 30, pause_density: 72, pitch_variation: 30, expressiveness: 38 };
}

function normalizeVoiceTraits(source, age) {
  const input = source && typeof source === 'object' ? source : recommendedVoiceTraits(age);
  return Object.fromEntries(Object.entries(DEFAULT_VOICE_TRAITS).map(([key, fallback]) => [key, key === 'accent' ? String(input[key] || '').trim().slice(0, 120) : clampNumber(input[key], 0, 100, fallback)]));
}

function normalizeVoiceGeneration(source = {}) {
  const preset = ['stable', 'balanced', 'explore', 'custom'].includes(String(source.preset)) ? String(source.preset) : 'balanced';
  const defaults = preset === 'custom' ? DEFAULT_VOICE_GENERATION : { ...DEFAULT_VOICE_GENERATION, ...VOICE_GENERATION_PRESETS[preset] };
  return {
    preset,
    do_sample: source.do_sample ?? defaults.do_sample,
    top_k: Math.round(clampNumber(source.top_k, 1, 200, defaults.top_k)),
    top_p: clampNumber(source.top_p, 0.05, 1, defaults.top_p),
    temperature: clampNumber(source.temperature, 0.1, 2, defaults.temperature),
    repetition_penalty: clampNumber(source.repetition_penalty, 1, 2, defaults.repetition_penalty),
    seed: Math.round(clampNumber(source.seed, 0, 2147483647, defaults.seed)),
    max_new_tokens: Math.round(clampNumber(source.max_new_tokens, 256, 8192, defaults.max_new_tokens)),
    candidate_count: Math.round(clampNumber(source.candidate_count, 1, 6, defaults.candidate_count)),
    subtalker_dosample: source.subtalker_dosample ?? defaults.subtalker_dosample,
    subtalker_top_k: Math.round(clampNumber(source.subtalker_top_k, 1, 200, defaults.subtalker_top_k)),
    subtalker_top_p: clampNumber(source.subtalker_top_p, 0.05, 1, defaults.subtalker_top_p),
    subtalker_temperature: clampNumber(source.subtalker_temperature, 0.1, 2, defaults.subtalker_temperature),
  };
}

const DEFAULT_PORTRAIT_STYLE = 'cinematic_manga';
const PORTRAIT_STYLE_PROMPTS = Object.freeze({
  cinematic_manga: '电影感漫画。清晰利落的轮廓线，细腻分层的赛璐璐上色，克制的综合色彩，电影式光影与景深，成熟叙事构图，保留自然面部比例和可连续复用的角色特征。',
  clean_cel: '清爽赛璐璐漫画。利落线稿，纯净色块，轻柔阴影，明快表情，角色轮廓清晰且辨识度高。',
  soft_watercolor: '柔光水彩漫画。透明水彩晕染，细微纸张颗粒，柔和边缘，空气感光线，情绪细腻。',
  noir_ink: '黑白悬疑墨线漫画。高反差黑白，硬朗墨线，密集排线，深沉阴影，紧张而克制的画面气氛。',
  retro_print: '复古网点印刷漫画。有限色盘，网点层次，轻微套色偏移，纸张质感，具有年代印刷气息。',
  neon_scifi: '霓虹科幻漫画。冷暖霓虹，锐利边缘光，未来材质，夜景氛围，清晰面部与服装结构。',
  storybook_gouache: '叙事绘本厚涂漫画。不透明颜料笔触，温暖综合色调，简洁造型，故事书式构图。',
  oriental_ink: '东方水墨漫画。墨色浓淡，充足留白，含蓄设色，流动笔触，强调人物气韵和神态。',
  ornate_fantasy: '华丽幻想漫画。精致服饰纹样，柔亮材质，层次丰富的装饰，梦幻环境光，人物主体明确。',
  urban_sketch: '都市速写漫画。松弛手绘线条，低饱和街景色彩，自然姿态，生活化构图。',
  pastel_emotion: '柔彩情感漫画。粉彩综合色调，柔软边缘，轻盈高光，克制表情，细腻情绪氛围。',
  dynamic_action: '动态动作漫画。有力线条，强透视，方向性光影，紧张构图，同时保持清晰面部特征。',
  compact_chibi: '轻巧 Q 版漫画。适度头身简化，圆润造型，清晰表情，干净色块，保留人物标志特征。',
  realistic_photo: '真人写实摄影。自然人体比例，真实皮肤与织物质感，摄影棚人像光线，电影级镜头语言，避免插画化和漫画化。',
});

function normalizePortraitStyle(value) {
  const style = String(value || '');
  return Object.hasOwn(PORTRAIT_STYLE_PROMPTS, style) ? style : DEFAULT_PORTRAIT_STYLE;
}

function normalizeVoiceCandidate(item) {
  const numeric = (key) => Number.isFinite(Number(item[key])) ? { [key]: Number(item[key]) } : {};
  return {
    voice_id: String(item.voice_id),
    seed: Math.round(Number(item.seed) || 0),
    ...numeric('raw_median_pitch_hz'),
    ...numeric('median_pitch_hz'),
    ...numeric('pitch_delta_hz'),
    ...numeric('pitch_target_tolerance_hz'),
    ...(typeof item.pitch_target_matched === 'boolean' ? { pitch_target_matched: item.pitch_target_matched } : {}),
    ...numeric('pitch_correction_semitones'),
    ...(item.pitch_correction_method ? { pitch_correction_method: String(item.pitch_correction_method) } : {}),
    ...numeric('pitch_calibration_version'),
    ...(typeof item.pitch_verified === 'boolean' ? { pitch_verified: item.pitch_verified } : {}),
    selected: Boolean(item.selected),
    ...(typeof item.gender_verified === 'boolean' ? { gender_verified: item.gender_verified } : {}),
    ...(typeof item.age_band_verified === 'boolean' ? { age_band_verified: item.age_band_verified } : {}),
    ...(typeof item.gender_identity_verified === 'boolean' ? { gender_identity_verified: item.gender_identity_verified } : {}),
    ...(item.gender_identity_method ? { gender_identity_method: String(item.gender_identity_method) } : {}),
  };
}

const DEFAULT_STORYBOARD_STYLE = 'cinematic_manga';
const STORYBOARD_STYLE_PROMPTS = Object.freeze({
  cinematic_manga: '电影感漫画分镜。成熟人物造型，清晰轮廓，细腻分层上色，克制综合色彩，电影式光影、景深和空间调度。',
  clean_cel: '清爽赛璐璐分镜。利落线稿，纯净色块，轻柔阴影，动作轮廓和空间关系清晰。',
  soft_watercolor: '柔光水彩分镜。透明水彩晕染，细微纸张颗粒，柔和边缘，空气感光线和细腻情绪。',
  noir_ink: '黑白悬疑墨线分镜。高反差黑白，硬朗墨线，密集排线，深沉阴影和紧张构图。',
  retro_print: '复古网点印刷分镜。有限色盘，网点层次，轻微套色偏移和年代纸张质感。',
  neon_scifi: '霓虹科幻分镜。冷暖霓虹，锐利边缘光，未来材质，夜景气氛和清楚空间层次。',
  storybook_gouache: '叙事绘本厚涂分镜。不透明颜料笔触，温暖综合色调，简洁造型和故事书式构图。',
  oriental_ink: '东方水墨分镜。墨色浓淡，充足留白，含蓄设色和流动笔触，强调空间气韵。',
  cinematic_realistic: '电影写实关键帧。真实人物比例、皮肤、织物和环境材质，电影摄影光线，自然镜头景深和可信空间透视。',
});

function normalizeStoryboardStyle(value) {
  const style = String(value || '');
  return Object.hasOwn(STORYBOARD_STYLE_PROMPTS, style) ? style : DEFAULT_STORYBOARD_STYLE;
}

function normalizeCharacterAsset(role, source = {}) {
  const gender = ['female', 'male', 'unspecified'].includes(source.gender)
    ? source.gender
    : inferCharacterGender(role?.[4], role?.[3], role?.[1]);
  const age = Math.max(5, Math.min(100, Math.round(Number(source.age) || 35)));
  const suggested = recommendPitchRange(gender, age);
  const min = Number.isFinite(Number(source.pitch_min_hz)) ? Number(source.pitch_min_hz) : suggested.min;
  const max = Number.isFinite(Number(source.pitch_max_hz)) ? Number(source.pitch_max_hz) : suggested.max;
  const requested = Number(source.pitch_target_hz);
  const target = Number.isFinite(requested) ? Math.max(min, Math.min(max, Math.round(requested))) : suggested.target;
  const standardReference = source.standard_reference?.source_voice_id ? {
    source_voice_id: String(source.standard_reference.source_voice_id),
    audition_text: String(source.standard_reference.audition_text || source.audition_text || DEFAULT_AUDITION_TEXT).trim().slice(0, 500) || DEFAULT_AUDITION_TEXT,
    pace_preset: ['自然', '舒缓', '自定义'].includes(source.standard_reference.pace_preset) ? source.standard_reference.pace_preset : '舒缓',
    duration_factor: Number.isFinite(Number(source.standard_reference.duration_factor))
      ? Math.max(0.5, Math.min(2, Number(source.standard_reference.duration_factor)))
      : source.standard_reference.pace_preset === '自然' ? 1.05 : source.standard_reference.pace_preset === '自定义' ? 1 : 1.18,
    generated_at: String(source.standard_reference.generated_at || ''),
    candidates: (Array.isArray(source.standard_reference.candidates) ? source.standard_reference.candidates : []).filter(item => item?.voice_id).slice(0, 3).map((item, index) => ({
      voice_id: String(item.voice_id),
      rank: Math.max(1, Math.round(Number(item.rank) || index + 1)),
      duration_seconds: Math.max(0, Number(item.duration_seconds) || 0),
      audio_quality_passed: Boolean(item.audio_quality_passed),
      speaker_similarity: Number(item.speaker_similarity) || 0,
      speaker_similarity_threshold: Number(item.speaker_similarity_threshold) || 0.72,
      speaker_verified: Boolean(item.speaker_verified),
      echo_similarity: Math.max(0, Number(item.echo_similarity) || 0),
      echo_threshold: Number(item.echo_threshold) || 0.72,
      echo_verified: Boolean(item.echo_verified),
      quality_passed: Boolean(item.quality_passed),
      score: Number(item.score) || 0,
      selected: Boolean(item.selected),
      generated_at: String(item.generated_at || source.standard_reference.generated_at || ''),
    })),
    ...(source.standard_reference.adopted_voice_id ? { adopted_voice_id: String(source.standard_reference.adopted_voice_id) } : {}),
    ...(source.standard_reference.adopted_at ? { adopted_at: String(source.standard_reference.adopted_at) } : {}),
    ...(source.standard_reference.restored_at ? { restored_at: String(source.standard_reference.restored_at) } : {}),
  } : undefined;
  return {
    gender, age, pitch_min_hz: min, pitch_max_hz: max, pitch_target_hz: target,
    audition_text: String(source.audition_text || DEFAULT_AUDITION_TEXT).trim().slice(0, 500) || DEFAULT_AUDITION_TEXT,
    voice_traits: normalizeVoiceTraits(source.voice_traits, age),
    voice_generation: normalizeVoiceGeneration(source.voice_generation),
    ...(Array.isArray(source.voice_candidates) ? { voice_candidates: source.voice_candidates.filter(item => item?.voice_id && item?.gender_verified !== false && item?.pitch_target_matched !== false).slice(0, 6).map(normalizeVoiceCandidate) } : {}),
    ...(source.reference_audio?.voice_id ? { reference_audio: {
      voice_id: String(source.reference_audio.voice_id),
      original_name: String(source.reference_audio.original_name || ''),
      uploaded_at: String(source.reference_audio.uploaded_at || ''),
      source_format: String(source.reference_audio.source_format || ''),
      size_bytes: Math.max(0, Math.round(Number(source.reference_audio.size_bytes) || 0)),
    } } : {}),
    ...(standardReference ? { standard_reference: standardReference } : {}),
    ...(source.portrait_url ? { portrait_url: String(source.portrait_url) } : {}),
    ...(source.portrait_prompt ? { portrait_prompt: String(source.portrait_prompt) } : {}),
    portrait_style: normalizePortraitStyle(source.portrait_style),
    ...(source.portrait_notes ? { portrait_notes: String(source.portrait_notes) } : {}),
    ...(source.profile_updated_by ? { profile_updated_by: String(source.profile_updated_by) } : {}),
    ...(source.age_source ? { age_source: String(source.age_source) } : {}),
    ...(source.age_evidence ? { age_evidence: String(source.age_evidence) } : {}),
    ...(source.gender_source ? { gender_source: String(source.gender_source) } : {}),
    ...(source.gender_evidence ? { gender_evidence: String(source.gender_evidence) } : {}),
  };
}

function safeProjectId(value) {
  const id = String(value || '');
  if (!/^[\w\-.\u4e00-\u9fff]+$/u.test(id) || path.basename(id) !== id) throw new Error('小说工程 ID 无效');
  return id;
}

function safeSlug(value) {
  return String(value || 'project').normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
}

function closestPreset(value, options, rules, fallback) {
  const text = String(value || '').trim();
  if (options.includes(text)) return text;
  const lower = text.toLowerCase();
  for (const [pattern, preset] of rules) if (pattern.test(lower)) return preset;
  return fallback;
}

function normalizeChapterSections(payload) {
  const copy = structuredClone(payload);
  copy.chapters = splitChapters(copy.source_text);
  copy.segments = assignNumberedChapterSections(copy.source_text, copy.chapters, copy.segments);
  if (copy.director_memory && typeof copy.director_memory === 'object' && Array.isArray(copy.director_memory.segments)) {
    const memorySource = String(copy.director_memory.source_text ?? copy.source_text ?? '');
    copy.director_memory.segments = assignNumberedChapterSections(
      memorySource,
      splitChapters(memorySource),
      copy.director_memory.segments,
    );
  }
  return copy;
}

function normalizeProject(payload) {
  const copy = structuredClone(payload);
  copy.content_type = ['auto', 'novel', 'news', 'commentary', 'story'].includes(copy.content_type) ? copy.content_type : 'auto';
  copy.pronunciations = Array.isArray(copy.pronunciations) ? copy.pronunciations.map(row => ({ source: String(row.source ?? row[0] ?? ''), replacement: String(row.replacement ?? row[1] ?? ''), note: String(row.note ?? row[2] ?? ''), enabled: row.enabled ?? !['否', 'false', '0'].includes(String(row[3]).toLowerCase()) })) : [];
  copy.roles = Array.isArray(copy.roles) ? copy.roles.map(row => {
    const updated = [...row];
    const name = String(updated[1] || '').trim();
    const kind = String(updated[2] || 'character');
    const profile = String(updated[3] || '').trim();
    const voiceCondition = String(updated[4] || '').trim();
    if (!profile || profile === name || ['由分句引用补全', '由说话归属文字识别'].includes(profile)) updated[3] = defaultRoleProfile(name || '未命名角色', kind);
    if (!voiceCondition || voiceCondition === name || voiceCondition === '根据角色内容选择') updated[4] = '中性清晰';
    updated[6] = closestPreset(updated[6], presets.rhythms, [[/沉稳|舒缓|从容/, '沉稳舒缓'], [/紧凑|清晰|利落/, '紧凑清晰'], [/轻快|活泼/, '轻快活泼'], [/克制|停连/, '克制停连'], [/低声|内敛/, '低声内敛'], [/威严|有力/, '威严有力']], '自然叙述');
    updated[7] = ['是', 'true', '1'].includes(String(updated[7]).toLowerCase()) ? '是' : '否';
    return updated;
  }) : [];
  const existingAssets = copy.character_assets && typeof copy.character_assets === 'object' ? copy.character_assets : {};
  copy.character_assets = Object.fromEntries(copy.roles.map(role => [String(role[0]), normalizeCharacterAsset(role, existingAssets[role[0]])]));
  copy.segments = Array.isArray(copy.segments) ? copy.segments.map(row => {
    const updated = [...row];
    if (updated.length < 13) updated.push('auto');
    if (updated.length < 14) updated.push('');
    if (updated.length < 15) updated.push('');
    if (updated.length < 16) updated.push(1);
    if (updated.length < 17) updated.push('none');
    if (updated.length < 18) updated.push('standard');
    updated[7] = closestPreset(updated[7], presets.attitudes, [[/沉稳/, '沉稳叙述'], [/温和|亲切/, '温和交流'], [/紧张|警觉/, '紧张警觉'], [/克制|低沉/, '克制低沉'], [/悲伤|压抑/, '悲伤压抑'], [/喜悦|明快/, '喜悦明快'], [/愤怒|强烈/, '愤怒强烈'], [/恐惧|迟疑/, '恐惧迟疑'], [/威严|命令/, '威严命令']], '中性叙述');
    updated[8] = closestPreset(updated[8], presets.emotions, [[/happy|joy|喜/, '喜悦'], [/angry|anger|愤/, '愤怒'], [/sad|悲/, '悲伤'], [/fear|恐/, '恐惧'], [/disgust|厌/, '厌恶'], [/depress|low|低落/, '低落'], [/surprise|惊/, '惊喜'], [/calm|neutral|自然|平静/, '平静']], '平静');
    updated[10] = closestPreset(updated[10], presets.paces, [[/舒缓|慢/, '舒缓'], [/紧凑|快/, '紧凑'], [/轻快/, '轻快'], [/克制/, '克制'], [/低声/, '低声'], [/强调|重音/, '强调']], '自然');
    updated[12] = presets.emotionDirections.some(item => item.value === updated[12]) ? updated[12] : 'auto';
    updated[13] = String(updated[13] || '').trim().slice(0, 1000);
    updated[14] = String(updated[14] || '').trim().slice(0, 80);
    updated[15] = Math.max(1, Math.round(Number(updated[15]) || 1));
    updated[16] = ['none', 'medium', 'strong'].includes(updated[16]) ? updated[16] : (updated[14] ? 'strong' : 'none');
    updated[17] = updated[17] === 'advanced' ? 'advanced' : 'standard';
    return updated;
  }) : [];
  return normalizeChapterSections(copy);
}

function validateProject(payload, id) {
  if (!payload || payload.project_id !== id) throw new Error('工程 ID 与请求不一致');
  if (!Array.isArray(payload.roles) || !Array.isArray(payload.segments)) throw new Error('角色表或分句表格式无效');
  const roleIds = new Set();
  payload.roles.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 8) throw new Error(`角色表第 ${index + 1} 行字段不足`);
    if (roleIds.has(row[0])) throw new Error(`角色 ID 重复 ${row[0]}`);
    roleIds.add(row[0]);
    if (!presets.roleKinds.includes(row[2])) throw new Error(`角色 ${row[1]} 的类型无效`);
    if (!String(row[3]).trim()) throw new Error(`角色 ${row[1]} 缺少人物小传`);
    if (!String(row[4]).trim()) throw new Error(`角色 ${row[1]} 缺少音色预设或高级提示`);
    if (!presets.rhythms.includes(row[6])) throw new Error(`角色 ${row[1]} 的节奏预设无效`);
    if (!['是', '否'].includes(row[7])) throw new Error(`角色 ${row[1]} 的重新生成选项无效`);
  });
  if (!payload.character_assets || typeof payload.character_assets !== 'object') payload.character_assets = {};
  for (const row of payload.roles) {
    const asset = payload.character_assets[row[0]] || normalizeCharacterAsset(row);
    payload.character_assets[row[0]] = asset;
    if (!['female', 'male', 'unspecified'].includes(asset.gender)) throw new Error(`角色 ${row[1]} 的性别设置无效`);
    if (!Number.isInteger(asset.age) || asset.age < 5 || asset.age > 100) throw new Error(`角色 ${row[1]} 的年龄必须在 5 至 100 岁之间`);
    if (![asset.pitch_min_hz, asset.pitch_max_hz, asset.pitch_target_hz].every(value => Number.isFinite(Number(value)))) throw new Error(`角色 ${row[1]} 的声音频率设置无效`);
    if (asset.pitch_min_hz >= asset.pitch_max_hz || asset.pitch_target_hz < asset.pitch_min_hz || asset.pitch_target_hz > asset.pitch_max_hz) throw new Error(`角色 ${row[1]} 的目标频率超出建议区间`);
    if (!asset.audition_text || asset.audition_text.length > 500) throw new Error(`角色 ${row[1]} 的试听文本必须在 1 至 500 字符之间`);
    if (!asset.voice_traits || Object.entries(asset.voice_traits).some(([key, value]) => key !== 'accent' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100))) throw new Error(`角色 ${row[1]} 的声音特征设置无效`);
    const generation = asset.voice_generation;
    if (!generation || !['stable', 'balanced', 'explore', 'custom'].includes(generation.preset) || generation.candidate_count < 1 || generation.candidate_count > 6) throw new Error(`角色 ${row[1]} 的音色生成参数无效`);
  }
  payload.segments.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 12) throw new Error(`分句表第 ${index + 1} 行字段不足`);
    if (row.length < 13) row.push('auto');
    if (row.length < 14) row.push('');
    if (row.length < 15) row.push('');
    if (row.length < 16) row.push(1);
    if (row.length < 17) row.push('none');
    if (row.length < 18) row.push('standard');
    if (!roleIds.has(row[2])) throw new Error(`分句 ${row[0]} 引用了未知角色`);
    if (!presets.languages.includes(row[4])) throw new Error(`分句 ${row[0]} 的语言无效`);
    if (!presets.attitudes.includes(row[7])) throw new Error(`分句 ${row[0]} 的态度预设无效`);
    if (!presets.emotions.includes(row[8])) throw new Error(`分句 ${row[0]} 的情绪预设无效`);
    if (!Number.isFinite(Number(row[9])) || Number(row[9]) < 0 || Number(row[9]) > 1) throw new Error(`分句 ${row[0]} 的情绪权重必须在 0 至 1 之间`);
    if (!presets.paces.includes(row[10])) throw new Error(`分句 ${row[0]} 的节奏预设无效`);
    if (!presets.emotionDirections.some(item => item.value === row[12])) throw new Error(`分句 ${row[0]} 的情绪演绎预设无效`);
    row[13] = String(row[13] || '').trim();
    if (row[12] === 'custom' && !row[13]) throw new Error(`分句 ${row[0]} 选择自定义情绪演绎后必须填写细化描述`);
    if (row[13].length > 1000) throw new Error(`分句 ${row[0]} 的情绪细化描述不能超过 1000 个字符`);
    row[14] = String(row[14] || '').trim();
    row[15] = Math.max(1, Math.round(Number(row[15]) || 1));
    if (row[14].length > 80) throw new Error(`分句 ${row[0]} 的重音文字不能超过 80 个字符`);
    if (!['none', 'medium', 'strong'].includes(row[16])) throw new Error(`分句 ${row[0]} 的重音强度无效`);
    if (!['standard', 'advanced'].includes(row[17])) throw new Error(`分句 ${row[0]} 的生成方式无效`);
    if (row[14]) {
      const synthesisText = String(row[6] || '');
      const matches = synthesisText.split(row[14]).length - 1;
      if (matches < row[15]) throw new Error(`分句 ${row[0]} 的合成文本中找不到第 ${row[15]} 个重音文字“${row[14]}”`);
      if (row[16] === 'none') throw new Error(`分句 ${row[0]} 已填写重音文字，请选择重音强度`);
    } else {
      row[15] = 1;
      row[16] = 'none';
    }
  });
  if (!['auto', 'novel', 'news', 'commentary', 'story'].includes(payload.content_type)) throw new Error('作品体裁无效');
  if (!Array.isArray(payload.pronunciations)) throw new Error('全篇纠音表格式无效');
  const pronunciationSources = new Set();
  payload.pronunciations.forEach((row, index) => {
    if (!row || !String(row.source || '').trim() || !String(row.replacement || '').trim()) throw new Error(`纠音表第 ${index + 1} 行缺少原词或朗读替换`);
    if (pronunciationSources.has(row.source)) throw new Error(`纠音表存在重复原词：${row.source}`);
    pronunciationSources.add(row.source);
  });
  payload.chapters = splitChapters(payload.source_text);
  return payload;
}

function directorSnapshot(payload) {
  return {
    source_text: String(payload.source_text || ''),
    roles: structuredClone(payload.roles || []),
    character_assets: structuredClone(payload.character_assets || {}),
    segments: structuredClone(payload.segments || []),
    pronunciations: structuredClone(payload.pronunciations || []),
    storyboard: structuredClone(payload.document?.scenes || []),
  };
}

function directorChangeKinds(before, after) {
  const kinds = [];
  if (before.source_text !== after.source_text) kinds.push('稿件文字');
  if (JSON.stringify(before.roles) !== JSON.stringify(after.roles)) kinds.push('角色与音色');
  if (JSON.stringify(before.character_assets) !== JSON.stringify(after.character_assets)) kinds.push('角色资产');
  if (JSON.stringify(before.segments.map(row => row.slice(0, 6))) !== JSON.stringify(after.segments.map(row => row.slice(0, 6)))) kinds.push('断句与角色分配');
  if (JSON.stringify(before.segments.map(row => row.slice(6))) !== JSON.stringify(after.segments.map(row => row.slice(6)))) kinds.push('合成文字与导演参数');
  if (JSON.stringify(before.pronunciations) !== JSON.stringify(after.pronunciations)) kinds.push('全篇纠音');
  if (JSON.stringify(before.storyboard) !== JSON.stringify(after.storyboard)) kinds.push('视频分镜');
  return kinds;
}

function preserveDirectorOperations(current, next) {
  const before = directorSnapshot(current);
  const after = directorSnapshot(next);
  const changes = directorChangeKinds(before, after);
  const history = Array.isArray(current.director_history) ? structuredClone(current.director_history) : [];
  if (changes.length) {
    history.push({
      operation_id: randomUUID(),
      recorded_at: new Date().toISOString(),
      actor: 'studio-user',
      changes,
      source_digest: createHash('sha256').update(after.source_text).digest('hex'),
      snapshot: after,
    });
  }
  next.director_history = history;
  next.director_memory = after;
  return next;
}

function projectForClient(project) {
  const history = Array.isArray(project.director_history) ? project.director_history : [];
  return {
    ...project,
    director_history: history.map(entry => {
      const { snapshot: _snapshot, ...summary } = entry || {};
      return summary;
    }),
  };
}

function segmentIdentity(row) {
  return JSON.stringify((row || []).slice(1));
}

function applyPronunciations(text, rules) {
  let result = String(text || '');
  const active = [...(rules || [])]
    .filter(rule => rule?.enabled !== false)
    .sort((left, right) => String(right?.source || '').length - String(left?.source || '').length);
  for (const rule of active) {
    const source = String(rule?.source || '');
    const replacement = String(rule?.replacement || '');
    if (source && result.includes(source)) result = result.split(source).join(replacement);
  }
  return result;
}

async function invalidateDirectorArtifacts(projectDir, current, next, changes) {
  if (!changes.length) return { invalidatedCacheKeys: [], staleRenders: 0 };
  const invalidateAll = changes.includes('稿件文字');
  const pronunciationAffectedRows = new Set((current.segments || []).filter(row => (
    applyPronunciations(row?.[6], current.pronunciations) !== applyPronunciations(row?.[6], next.pronunciations)
  )));
  const nextRoles = new Map((next.roles || []).map(row => [String(row?.[0] || ''), JSON.stringify(row || [])]));
  const changedRoleIds = new Set((current.roles || [])
    .filter(row => nextRoles.get(String(row?.[0] || '')) !== JSON.stringify(row || []))
    .map(row => String(row?.[0] || '')));
  const currentAssets = current.character_assets || {};
  const nextAssets = next.character_assets || {};
  for (const roleId of new Set([...Object.keys(currentAssets), ...Object.keys(nextAssets)])) {
    const voiceFields = asset => ({
      gender: asset?.gender,
      age: asset?.age,
      pitch_min_hz: asset?.pitch_min_hz,
      pitch_max_hz: asset?.pitch_max_hz,
      pitch_target_hz: asset?.pitch_target_hz,
      audition_text: asset?.audition_text,
      voice_traits: asset?.voice_traits,
      voice_generation: asset?.voice_generation,
    });
    if (JSON.stringify(voiceFields(currentAssets[roleId])) !== JSON.stringify(voiceFields(nextAssets[roleId]))) changedRoleIds.add(roleId);
  }
  const nextIdentities = new Set((next.segments || []).map(segmentIdentity));
  const invalidatedRows = (current.segments || []).filter(row => invalidateAll
    || pronunciationAffectedRows.has(row)
    || changedRoleIds.has(String(row?.[2] || ''))
    || !nextIdentities.has(segmentIdentity(row)));
  const invalidatedSignatures = new Set(invalidatedRows.map(row => `${row[2]}\u0000${row[4]}\u0000${row[5]}\u0000${row[6]}`));
  const invalidatedCacheKeys = new Set();
  const invalidationReasons = changes.filter(change => change !== '全篇纠音' || pronunciationAffectedRows.size > 0);
  const rendersDir = path.join(projectDir, 'renders');
  let staleRenders = 0;
  const affectedRenders = [];
  try {
    const renderEntries = await readdir(rendersDir, { withFileTypes: true });
    for (const entry of renderEntries.filter(item => item.isDirectory())) {
      const renderDir = path.join(rendersDir, entry.name);
      try {
        const manifest = JSON.parse(await readFile(path.join(renderDir, 'director-manifest.json'), 'utf8'));
        let affected = false;
        for (const item of manifest.segments || []) {
          const signature = `${item.speaker_id}\u0000${item.language}\u0000${item.source_text}\u0000${item.text}`;
          if (invalidatedSignatures.has(signature)) {
            affected = true;
            invalidatedCacheKeys.add(String(item.cache_key || ''));
          }
        }
        if (affected) affectedRenders.push(renderDir);
      } catch {}
    }
  } catch {}

  const fragmentIndexPath = path.join(projectDir, 'process', 'segment-fragments.json');
  try {
    const index = JSON.parse(await readFile(fragmentIndexPath, 'utf8'));
    for (const [cacheKey, item] of Object.entries(index.fragments || {})) {
      const signature = `${item.speaker_id}\u0000${item.language}\u0000${item.source_text}\u0000${item.text}`;
      if (invalidatedSignatures.has(signature)) {
        invalidatedCacheKeys.add(cacheKey);
        delete index.fragments[cacheKey];
      }
    }
    const temporary = `${fragmentIndexPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    await rename(temporary, fragmentIndexPath);
  } catch {}
  for (const cacheKey of invalidatedCacheKeys) {
    if (/^[a-f0-9]{64}$/.test(cacheKey)) {
      try { await unlink(path.join(projectDir, 'process', 'segment-cache', `${cacheKey}.wav`)); } catch {}
      try { await rm(path.join(projectDir, 'process', 'segment-candidates', cacheKey), { recursive: true, force: true }); } catch {}
    }
  }
  const staleAt = new Date().toISOString();
  for (const renderDir of affectedRenders) {
    const stalePath = path.join(renderDir, '.stale.json');
    let previous = {};
    try { previous = JSON.parse(await readFile(stalePath, 'utf8')); } catch {}
    const stale = {
      stale: true,
      stale_at: staleAt,
      reasons: [...new Set([...(previous.reasons || []), ...invalidationReasons])],
      invalidated_cache_keys: [...new Set([...(previous.invalidated_cache_keys || []), ...invalidatedCacheKeys])].filter(Boolean),
    };
    await writeFile(stalePath, `${JSON.stringify(stale, null, 2)}\n`, 'utf8');
    staleRenders += 1;
  }
  return { invalidatedCacheKeys: [...invalidatedCacheKeys].filter(Boolean), staleRenders };
}

async function latestRender(projectDir) {
  const rendersDir = path.join(projectDir, 'renders');
  try {
    const entries = await readdir(rendersDir, { withFileTypes: true });
    const candidates = (await Promise.all(entries.filter(item => item.isDirectory()).map(async item => {
      const renderDir = path.join(rendersDir, item.name);
      try { return { name: item.name, time: (await stat(path.join(renderDir, 'director-manifest.json'))).mtimeMs }; }
      catch { return undefined; }
    }))).filter(Boolean);
    return candidates.sort((a, b) => b.time - a.time)[0]?.name;
  } catch { return undefined; }
}

async function renderCaptions(projectDir, renderName) {
  if (!renderName) return [];
  const renderDir = path.join(projectDir, 'renders', renderName);
  try {
    const manifest = JSON.parse(await readFile(path.join(renderDir, 'director-manifest.json'), 'utf8'));
    const captions = [];
    for (const item of manifest.segments || []) {
      try {
        const filename = path.basename(String(item.audio || '').replaceAll('\\', '/'));
        const durationSeconds = await wavDurationSeconds(path.join(renderDir, 'segments', filename));
        captions.push({ order: Number(item.order), speakerName: String(item.speaker_name || '').trim(), text: String(item.source_text || item.text || '').trim(), durationSeconds, pauseAfterMs: Math.max(0, Number(item.pause_after_ms) || 0) });
      } catch {}
    }
    return captions;
  } catch { return []; }
}

export async function wavDurationSeconds(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const info = await handle.stat();
    const header = Buffer.alloc(Math.min(info.size, 65536));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 12 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV 头无效');
    let byteRate = 0;
    let dataSize = 0;
    for (let offset = 12; offset + 8 <= bytesRead;) {
      const chunkId = header.toString('ascii', offset, offset + 4);
      const chunkSize = header.readUInt32LE(offset + 4);
      const dataOffset = offset + 8;
      if (chunkId === 'fmt ' && chunkSize >= 12 && dataOffset + 12 <= bytesRead) byteRate = header.readUInt32LE(dataOffset + 8);
      if (chunkId === 'data') { dataSize = chunkSize; break; }
      offset = dataOffset + chunkSize + (chunkSize % 2);
    }
    if (!byteRate || !dataSize) throw new Error('WAV 时长信息缺失');
    return dataSize / byteRate;
  } finally {
    await handle.close();
  }
}

export function reconcileFragmentsToProject(manifestFragments, draftFragments, projectSegments) {
  const candidates = [
    ...manifestFragments.map((fragment, index) => ({ fragment, source: 'manifest', index })),
    ...draftFragments.map((fragment, index) => ({ fragment, source: 'draft', index })),
  ];
  const consumed = new Set();
  const aligned = [];
  for (const segment of projectSegments || []) {
    const order = Number(segment?.[0]);
    const sourceText = String(segment?.[5] || '');
    const synthesisText = String(segment?.[6] || '');
    const matches = candidates.filter(candidate => (
      !consumed.has(candidate)
      && candidate.fragment.sourceText === sourceText
      && candidate.fragment.synthesisText === synthesisText
    ));
    matches.sort((left, right) => {
      const leftExact = Number(left.fragment.order) === order ? 1 : 0;
      const rightExact = Number(right.fragment.order) === order ? 1 : 0;
      if (leftExact !== rightExact) return rightExact - leftExact;
      const leftDraft = left.source === 'draft' ? 1 : 0;
      const rightDraft = right.source === 'draft' ? 1 : 0;
      if (leftDraft !== rightDraft) return rightDraft - leftDraft;
      const distance = Math.abs(Number(left.fragment.order) - order) - Math.abs(Number(right.fragment.order) - order);
      if (distance) return distance;
      return left.index - right.index;
    });
    const selected = matches[0];
    if (!selected) continue;
    consumed.add(selected);
    aligned.push({ ...selected.fragment, order });
  }
  return aligned;
}

async function voiceRuntimeHealth(repoRoot) {
  try {
    const state = JSON.parse(await readFile(path.join(repoRoot, 'runtime-output', 'voice-design-runtime', 'state.json'), 'utf8'));
    let processAlive = false;
    if (Number.isSafeInteger(state.pid) && state.pid > 0) {
      try { process.kill(state.pid, 0); processAlive = true; } catch {}
    }
    return {
      processAlive,
      modelLoaded: processAlive && Boolean(state.model_loaded),
      phase: processAlive ? String(state.phase || 'ready') : 'stopped',
      pid: processAlive ? state.pid : undefined,
      modelDir: processAlive && state.model_dir ? String(state.model_dir) : undefined,
    };
  } catch {
    return { processAlive: false, modelLoaded: false, phase: 'cold' };
  }
}

function normalizeAiEndpoint(value) {
  const text = String(value || '').trim().replace(/\/+$/u, '');
  if (!text) return '';
  const parsed = new URL(text);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('兼容服务 Endpoint 必须使用 HTTP 或 HTTPS');
  return text;
}

function normalizeOllamaEndpoint(value) {
  const text = String(value || 'http://127.0.0.1:11434').trim().replace(/\/+$/u, '');
  const parsed = new URL(text);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Ollama Endpoint 必须使用 HTTP 或 HTTPS');
  return text;
}

function configuredOllamaEndpoint(value) {
  return normalizeOllamaEndpoint(process.env.INDEXTTS_OLLAMA_ENDPOINT || value || 'http://127.0.0.1:11434');
}

export function workerPython(repoRoot, platform = process.platform) {
  const configured = String(process.env.INDEXTTS_PYTHON || '').trim();
  if (configured) return path.resolve(configured);
  return platform === 'win32' ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe') : 'python3';
}

function aiRoute(endpoint, route) {
  return `${endpoint}${endpoint.endsWith('/v1') ? '' : '/v1'}${route}`;
}

function publicHttpEndpoint(endpoint) {
  if (!endpoint) return false;
  const parsed = new URL(endpoint);
  const host = parsed.hostname.toLowerCase();
  return parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(host);
}

function assertEndpointTransport(settings) {
  if (publicHttpEndpoint(settings.endpoint) && !settings.allow_insecure_http) {
    throw new Error('当前 Endpoint 使用公网 HTTP。为避免 Bearer Key 明文传输，请配置 HTTPS；如已了解风险，可在系统配置中明确允许公网 HTTP');
  }
}

function compatibleHeaders(settings, json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${settings.api_key}`,
    ...(settings.instance_id ? { 'X-Cockpit-Instance-Id': settings.instance_id } : {}),
  };
}

async function readAiMediaSettings(file) {
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'));
    return {
      endpoint: normalizeAiEndpoint(stored.endpoint),
      api_key: String(stored.api_key || ''),
      text_model: String(stored.text_model || 'gemini-2.5-pro'),
      director_provider: stored.director_provider === 'compatible' ? 'compatible' : 'ollama',
      director_model: String(stored.director_model || 'qwen3:14b'),
      ollama_endpoint: configuredOllamaEndpoint(stored.ollama_endpoint),
      director_max_chunk_chars: Math.max(320, Math.min(12000, Math.round(Number(stored.director_max_chunk_chars) || 1400))),
      image_model: String(stored.image_model || 'gpt-image-1'),
      image_fallback_model: String(stored.image_fallback_model || ''),
      image_fallback_enabled: Boolean(stored.image_fallback_enabled),
      instance_id: String(stored.instance_id || ''),
      text_api: stored.text_api === 'responses' ? 'responses' : 'chat_completions',
      allow_insecure_http: Boolean(stored.allow_insecure_http),
    };
  } catch {
    return { endpoint: '', api_key: '', text_model: 'gemini-2.5-pro', director_provider: 'ollama', director_model: 'qwen3:14b', ollama_endpoint: configuredOllamaEndpoint(), director_max_chunk_chars: 1400, image_model: 'gpt-image-1', image_fallback_model: '', image_fallback_enabled: false, instance_id: '', text_api: 'chat_completions', allow_insecure_http: false };
  }
}

function publicAiMediaSettings(settings) {
  return {
    endpoint: settings.endpoint,
    textModel: settings.text_model,
    directorProvider: settings.director_provider,
    directorModel: settings.director_model,
    ollamaEndpoint: settings.ollama_endpoint,
    directorMaxChunkChars: settings.director_max_chunk_chars,
    imageModel: settings.image_model,
    imageFallbackModel: settings.image_fallback_model,
    imageFallbackEnabled: settings.image_fallback_enabled,
    instanceId: settings.instance_id,
    textApi: settings.text_api,
    allowInsecureHttp: settings.allow_insecure_http,
    transportRisk: publicHttpEndpoint(settings.endpoint),
    hasApiKey: Boolean(settings.api_key),
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('操作已取消');
  error.name = 'AbortError';
  throw error;
}

function requestAbortSignal(request, reply) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new DOMException('操作已取消', 'AbortError'));
  };
  if (request.raw.aborted) abort();
  else request.raw.once('aborted', abort);
  reply.raw.once('close', () => {
    if (!reply.raw.writableEnded) abort();
  });
  return controller.signal;
}

function requestErrorStatus(error) {
  return error?.name === 'AbortError' ? 499 : error?.statusCode || 400;
}

async function callCompatibleJson(remoteFetch, url, settings, payload, signal) {
  assertEndpointTransport(settings);
  throwIfAborted(signal);
  const response = await remoteFetch(url, {
    method: 'POST',
    headers: compatibleHeaders(settings, true),
    body: JSON.stringify(payload),
    signal,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {}; }
  if (!response.ok) throw compatibleServiceError(response, body);
  return body;
}

async function discoverCompatibleModels(remoteFetch, settings, signal) {
  assertEndpointTransport(settings);
  const response = await remoteFetch(aiRoute(settings.endpoint, '/models'), {
    headers: compatibleHeaders(settings),
    signal,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {}; }
  if (!response.ok) throw new Error(String(body?.error?.message || body?.message || `兼容服务模型列表请求失败 ${response.status}`));
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const models = [...new Set(rows.map(item => String(item?.id || item?.name || '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  if (!models.length) throw new Error('兼容服务连接成功，但没有返回可选择的模型 ID');
  return models;
}

async function discoverOllamaModels(remoteFetch, endpoint, signal) {
  const response = await remoteFetch(`${normalizeOllamaEndpoint(endpoint)}/api/tags`, { signal });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {}; }
  if (!response.ok) throw new Error(String(body?.error || body?.message || `Ollama 模型列表请求失败 ${response.status}`));
  const rows = Array.isArray(body?.models) ? body.models : [];
  const models = [...new Set(rows.map(item => String(item?.name || item?.model || '').trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  if (!models.length) throw new Error('Ollama 已连接，但没有返回可选择的模型');
  return models;
}

function extractCompatibleText(body) {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  const responsesText = body?.output?.flatMap(item => Array.isArray(item?.content) ? item.content : []).map(item => item?.text || item?.output_text || '').filter(Boolean).join('\n').trim();
  if (responsesText) return responsesText;
  const openAiText = body?.choices?.[0]?.message?.content;
  if (typeof openAiText === 'string' && openAiText.trim()) return openAiText.trim();
  const geminiText = body?.candidates?.[0]?.content?.parts?.map(part => part?.text || '').join('\n').trim();
  if (geminiText) return geminiText;
  throw new Error('兼容服务没有返回可用人物小传');
}

function characterEvidence(sourceText, name) {
  const source = String(sourceText || '');
  const lines = source.split(/(?<=[。！？!?\n])/u);
  const indexes = lines.map((line, index) => line.includes(name) ? index : -1).filter(index => index >= 0);
  const selected = new Set();
  for (const index of indexes) for (let offset = -2; offset <= 2; offset += 1) if (lines[index + offset]) selected.add(index + offset);
  const evidence = [...selected].sort((a, b) => a - b).map(index => lines[index]).join('').trim();
  return (evidence || source).slice(0, 30000);
}

function portraitPrompt({ name, profile, gender, age, portraitStyle, portraitPrompt }) {
  const genderLabel = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '性别以人物设定为准';
  const custom = String(portraitPrompt || '').trim();
  const style = normalizePortraitStyle(portraitStyle);
  const realistic = style === 'realistic_photo';
  return [
    `为长篇声音作品中的角色“${name}”创作统一角色设定图。`,
    `人物设定：${profile}`,
    `年龄：约 ${age} 岁。性别：${genderLabel}。`,
    `画面风格：${PORTRAIT_STYLE_PROMPTS[style]}`,
    custom ? `补充视觉要求：${custom}` : '',
    realistic
      ? '单人半身真人肖像，面部清晰，服装、发型、神态和时代背景与人物小传一致。中性背景，自然人像光线，保持可用于后续插图和视频关键帧的稳定真人角色设计。'
      : '单人半身漫画角色肖像，面部清晰，服装、发型、神态和时代背景与人物小传一致。保持统一线条、上色规则和可用于后续插图及视频关键帧的稳定漫画角色设计。',
    '画面中不出现文字、水印、界面、边框、标志或其他人物。',
  ].filter(Boolean).join('\n');
}

function sceneKeyframePrompt(project, scene, requestedStyle, referenceCharacters = []) {
  const style = normalizeStoryboardStyle(requestedStyle || scene.keyframe_style);
  const sceneId = safeProjectId(scene.id);
  const note = String(scene.storyboard_note || '').trim();
  const shotSource = String(scene.source_text || scene.source_excerpt || '').trim();
  if (note.length < 20) throw new Error(`镜头 ${sceneId} 的画面小记至少需要 20 个字符`);
  const participants = new Set(Array.isArray(scene.participants) ? scene.participants.map(String) : []);
  const roleDetails = (project.roles || []).filter(role => participants.has(String(role[0]))).map(role => {
    const asset = project.character_assets?.[role[0]] || {};
    const gender = asset.gender === 'female' ? '女性' : asset.gender === 'male' ? '男性' : '性别未指定';
    return `${role[1]}（${gender}，约 ${asset.age || 35} 岁）：${String(role[3] || '').slice(0, 900)}`;
  });
  return [
    `为声音作品“${project.title}”制作一张 16:9 视频分镜关键帧。场景 ID：${sceneId}。`,
    `分镜标题：${String(scene.title || sceneId)}。内容主题：${String(scene.topic || '未说明')}。`,
    `地点：${String(scene.location || '未说明')}。空间方位或观察方向：${String(scene.spatial_direction || '未说明')}。故事内时间：${String(scene.time || '未说明')}。`,
    `场景基调：${String(scene.mood || '中性')}。叙事视角：${String(scene.narrative_perspective || '未说明')}。`,
    shotSource ? `镜头对应原文：${shotSource.slice(0, 2000)}` : '',
    `AI 镜头画面小记：${note}`,
    roleDetails.length ? `需要保持连续一致的角色设定：\n${roleDetails.join('\n')}` : '本镜头没有需要明确展示的已登记角色。',
    referenceCharacters.length ? [
      '人物身份参考图映射：',
      ...referenceCharacters.map((reference, index) => `参考图 ${index + 1} 对应稳定角色 ${reference.roleId}“${reference.name}”。`),
      '参考图只用于锁定对应人物身份。生成结果必须保持每个人的面部结构、五官比例、发型、年龄感和标志特征与对应参考图一致。姿势、表情、服装状态、镜头角度和环境可以服从本镜头画面小记。不得交换、混合或复制不同参考图中的人物身份。',
    ].join('\n') : '',
    `画面风格：${STORYBOARD_STYLE_PROMPTS[style]}`,
    '输出单张横向关键帧。完整呈现场景小记中的主体位置、动作、前后景、镜头方向、光线、色彩和关键物件，保持人物身份和时代背景一致。',
    '画面中不出现字幕、对白文字、标题、水印、界面、边框或标志。不拼接多格分镜。',
  ].filter(Boolean).join('\n');
}

function localRoleAssetLocation(portraitUrl) {
  const match = String(portraitUrl || '').match(/^\/api\/projects\/([^/?#]+)\/role-assets\/([^/?#]+)$/u);
  if (!match) throw new Error('角色形象必须是工程内已保存的角色图片');
  return {
    sourceProjectId: safeProjectId(decodeURIComponent(match[1])),
    filename: safeProjectId(decodeURIComponent(match[2])),
  };
}

function imageMimeType(bytes) {
  const extension = imageExtension(bytes);
  return extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
}

async function resolveSceneCharacterReferences(projectRoot, project, scene) {
  const participantIds = [...new Set((Array.isArray(scene.participants) ? scene.participants : []).map(value => String(value).trim()).filter(Boolean))];
  const roleById = new Map((project.roles || []).map(role => [String(role[0]), role]));
  const unknownIds = participantIds.filter(roleId => !roleById.has(roleId));
  if (unknownIds.length) throw new Error(`参与人物尚未登记为稳定角色：${unknownIds.join('、')}。请先在角色资产中补充角色并生成形象`);
  const participantSet = new Set(participantIds);
  const visualRoles = (project.roles || []).filter(role => participantSet.has(String(role[0])) && String(role[2]) !== 'narrator');
  if (visualRoles.length > 16) throw new Error('一个分镜镜头最多使用 16 个角色身份参考图，请先拆分镜头');
  const missingPortraits = visualRoles.filter(role => !String(project.character_assets?.[role[0]]?.portrait_url || '').trim());
  if (missingPortraits.length) throw new Error(`以下画面人物缺少角色形象：${missingPortraits.map(role => role[1]).join('、')}。请先在角色资产中生成并保存形象`);

  const references = [];
  for (const role of visualRoles) {
    const roleId = String(role[0]);
    const portraitUrl = String(project.character_assets?.[roleId]?.portrait_url || '').trim();
    let location;
    try { location = localRoleAssetLocation(portraitUrl); }
    catch (error) { throw new Error(`角色“${role[1]}”的形象无法作为身份参考：${error.message}`); }
    const assetPath = path.join(projectRoot, location.sourceProjectId, 'role-assets', location.filename);
    let info;
    let bytes;
    try {
      info = await stat(assetPath);
      if (!info.isFile() || info.size <= 0 || info.size > 20 * 1024 * 1024) throw new Error('文件为空或超过 20 MB');
      bytes = await readFile(assetPath);
    } catch (error) { throw new Error(`角色“${role[1]}”的身份参考图无法读取：${error.message}`); }
    let mimeType;
    try { mimeType = imageMimeType(bytes); }
    catch (error) { throw new Error(`角色“${role[1]}”的身份参考图格式无效：${error.message}`); }
    references.push({
      roleId,
      name: String(role[1]),
      portraitUrl,
      portraitSha256: createHash('sha256').update(bytes).digest('hex'),
      sourceProjectId: location.sourceProjectId,
      filename: location.filename,
      mimeType,
      bytes,
    });
  }
  return references;
}

async function callCompatibleImageEdit(remoteFetch, settings, model, prompt, references, signal) {
  assertEndpointTransport(settings);
  throwIfAborted(signal);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', '1536x1024');
  form.append('n', '1');
  for (const reference of references) {
    form.append('image[]', new Blob([reference.bytes], { type: reference.mimeType }), `${safeSlug(reference.roleId)}-${reference.filename}`);
  }
  const response = await remoteFetch(aiRoute(settings.endpoint, '/images/edits'), {
    method: 'POST',
    headers: compatibleHeaders(settings),
    body: form,
    signal,
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {}; }
  if (!response.ok) {
    const error = compatibleServiceError(response, body);
    error.message = `角色参考图关键帧生成失败：${error.message}。当前服务必须支持 Images Edits 多图参考，系统未回退到纯文字生成`;
    throw error;
  }
  return body;
}

async function decodeCompatibleImage(remoteFetch, item, settings, signal) {
  if (item?.b64_json) return Buffer.from(String(item.b64_json), 'base64');
  if (item?.inline_data?.data) return Buffer.from(String(item.inline_data.data), 'base64');
  if (item?.inlineData?.data) return Buffer.from(String(item.inlineData.data), 'base64');
  if (item?.url) {
    const imageUrl = String(item.url);
    const sameOrigin = new URL(imageUrl).origin === new URL(settings.endpoint).origin;
    const response = await remoteFetch(imageUrl, { headers: sameOrigin ? compatibleHeaders(settings) : {}, signal });
    if (!response.ok) throw new Error(`兼容服务图像下载失败 ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('兼容服务没有返回图像数据');
}

async function generateSceneKeyframe({ remoteFetch, settings, projectRoot, projectId, project, scene, requestedStyle, requestedModel, allowFallback, imageModelCooldowns, signal }) {
  throwIfAborted(signal);
  const style = normalizeStoryboardStyle(requestedStyle || scene.keyframe_style);
  const references = await resolveSceneCharacterReferences(projectRoot, project, scene);
  const publicReferences = references.map(({ bytes: _bytes, filename: _filename, mimeType: _mimeType, sourceProjectId: _sourceProjectId, ...reference }) => reference);
  const basePrompt = sceneKeyframePrompt(project, scene, style, publicReferences);
  const routed = await runWithImageModelFallback({
    settings,
    requestedModel,
    allowFallback,
    cooldowns: imageModelCooldowns,
    execute: async model => {
      const prompt = adaptImagePrompt(basePrompt, model, 'storyboard');
      const response = references.length
        ? await callCompatibleImageEdit(remoteFetch, settings, model, prompt, references, signal)
        : await callCompatibleJson(remoteFetch, aiRoute(settings.endpoint, '/images/generations'), settings, {
          model, prompt, size: '1536x1024', n: 1, response_format: 'b64_json',
        }, signal);
      const item = response?.data?.[0] || response?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData || part?.inline_data);
      const bytes = await decodeCompatibleImage(remoteFetch, item, settings, signal);
      return { bytes, prompt };
    },
  });
  const { bytes, prompt } = routed.value;
  throwIfAborted(signal);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('兼容服务返回的关键帧为空或超过 20 MB');
  const extension = imageExtension(bytes);
  const assetsDir = path.join(projectRoot, projectId, 'scene-assets');
  await mkdir(assetsDir, { recursive: true });
  const sceneId = safeProjectId(scene.id);
  const filename = `${safeSlug(sceneId)}-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`;
  await writeFile(path.join(assetsDir, filename), bytes);
  return {
    sceneId,
    keyframeUrl: `/api/projects/${encodeURIComponent(projectId)}/scene-assets/${encodeURIComponent(filename)}`,
    keyframePrompt: prompt,
    keyframeStyle: style,
    generatedAt: new Date().toISOString(),
    model: routed.actualModel,
    requestedModel: routed.requestedModel,
    modelFallbackUsed: routed.fallbackUsed,
    modelFallbackReason: routed.fallbackReason,
    modelPromptProfile: routed.promptProfile,
    identityReferenceMode: references.length ? 'role_portraits' : 'no_visual_characters',
    referenceCharacters: publicReferences,
  };
}

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  throw new Error('兼容服务返回了无法识别的图像格式');
}

const REFERENCE_AUDIO_TYPES = Object.freeze([
  'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/flac', 'audio/x-flac',
  'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'application/ogg', 'application/octet-stream',
]);

function referenceAudioFormat(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) throw new Error('参考音频为空或内容不完整');
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return 'wav';
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
  if (bytes.subarray(0, 4).toString('ascii') === 'fLaC') return 'flac';
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'ogg';
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'm4a';
  if (bytes[0] === 0xff && (bytes[1] === 0xf1 || bytes[1] === 0xf9)) return 'aac';
  throw new Error('无法识别参考音频格式，请上传 WAV、MP3、FLAC、M4A、AAC 或 OGG');
}

function normalizeReferenceAudio(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', '60', '-vn',
      '-map_metadata', '-1', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-f', 'wav', output,
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('参考音频转换失败，请确认文件未损坏且包含有效音轨')));
  });
}

function launchMp3Encoder(file) {
  return spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', file, '-vn',
    '-codec:a', 'libmp3lame', '-b:a', '160k', '-f', 'mp3', 'pipe:1',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function buildApp({ repoRoot = defaultRepoRoot, launchWorker, spawnWorker = spawn, launchEncoder = launchMp3Encoder, convertReferenceAudio = normalizeReferenceAudio, remoteFetch = fetch, killProcess = process.kill } = {}) {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
  app.addContentTypeParser(REFERENCE_AUDIO_TYPES, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  const projectRoot = path.join(repoRoot, 'outputs', 'novel-projects');
  const distRoot = path.join(repoRoot, 'product-studio', 'dist');
  const jobRoot = path.join(repoRoot, 'runtime-output', 'product-jobs');
  const productVersion = (await readFile(path.join(repoRoot, 'VERSION'), 'utf8')).trim();
  const imageModelCooldowns = new Map();
  const aiMediaSettingsFile = path.join(repoRoot, 'runtime-output', 'product-settings.json');

  async function reconcileRoleVoiceFiles(project) {
    const existing = Array.isArray(project.voice_files) ? project.voice_files.map(value => String(value)) : [];
    const resolved = [...existing];
    for (const role of project.roles || []) {
      const voiceId = String(role?.[5] || '').trim().replace(/\.wav$/i, '');
      if (!/^(voice-|legacy-)[\w-]+$/i.test(voiceId)) continue;
      const roleVoice = path.join(repoRoot, 'outputs', 'voice-library', `${voiceId}.wav`);
      try {
        await access(roleVoice);
        resolved.push(roleVoice);
      } catch {}
    }
    project.voice_files = [...new Set(resolved)];
    return project.voice_files.length !== existing.length || project.voice_files.some((value, index) => value !== existing[index]);
  }

  async function importLinkedProjectRoles(sourceProjectIds, importedAt) {
    const requestedIds = Array.isArray(sourceProjectIds) ? sourceProjectIds : [];
    const uniqueIds = [...new Set(requestedIds.map(value => safeProjectId(value)))];
    if (uniqueIds.length > 20) throw new Error('一次最多关联 20 个来源工程');
    const roles = [];
    const characterAssets = {};
    const voiceFiles = [];
    const linkedProjects = [];
    const usedRoleIds = new Set();
    const pronunciations = [];
    const pronunciationOwners = new Map();

    for (const sourceProjectId of uniqueIds) {
      const sourcePath = path.join(projectRoot, sourceProjectId, 'project.json');
      let source;
      try {
        const stored = JSON.parse(await readFile(sourcePath, 'utf8'));
        const normalizedRoles = normalizeProject({
          content_type: stored.content_type,
          source_text: '',
          roles: stored.roles,
          character_assets: stored.character_assets,
          segments: [],
          pronunciations: stored.pronunciations,
        });
        source = { title: stored.title, roles: normalizedRoles.roles, character_assets: normalizedRoles.character_assets, pronunciations: normalizedRoles.pronunciations };
      }
      catch { throw new Error(`关联来源工程不存在或无法读取：${sourceProjectId}`); }
      const importedRoles = [];
      for (const sourceRole of source.roles) {
        const sourceRoleId = String(sourceRole[0]);
        let targetRoleId = sourceRoleId;
        let suffix = 2;
        while (usedRoleIds.has(targetRoleId)) targetRoleId = `${sourceRoleId}-${suffix++}`;
        usedRoleIds.add(targetRoleId);
        const targetRole = structuredClone(sourceRole);
        targetRole[0] = targetRoleId;
        roles.push(targetRole);

        const sourceAsset = structuredClone(source.character_assets?.[sourceRoleId] || normalizeCharacterAsset(sourceRole));
        characterAssets[targetRoleId] = sourceAsset;
        const voiceIds = [...new Set([
          String(sourceRole[5] || '').trim().replace(/\.wav$/i, ''),
          ...(sourceAsset.voice_candidates || []).map(candidate => String(candidate.voice_id || '').trim().replace(/\.wav$/i, '')),
        ].filter(value => /^(voice-|legacy-)[\w-]+$/i.test(value)))];
        const availableVoiceIds = [];
        const missingVoiceIds = [];
        for (const voiceId of voiceIds) {
          const voiceFile = path.join(repoRoot, 'outputs', 'voice-library', `${voiceId}.wav`);
          try { await access(voiceFile); voiceFiles.push(voiceFile); availableVoiceIds.push(voiceId); }
          catch { missingVoiceIds.push(voiceId); }
        }
        importedRoles.push({
          source_role_id: sourceRoleId,
          target_role_id: targetRoleId,
          name: String(sourceRole[1] || ''),
          voice_ids: voiceIds,
          available_voice_ids: availableVoiceIds,
          missing_voice_ids: missingVoiceIds,
        });
      }
      const duplicatePronunciations = [];
      const conflictingPronunciations = [];
      let importedPronunciationCount = 0;
      for (const sourcePronunciation of source.pronunciations) {
        const pronunciation = structuredClone(sourcePronunciation);
        const sourceText = String(pronunciation.source || '');
        const existing = pronunciationOwners.get(sourceText);
        if (!existing) {
          pronunciations.push(pronunciation);
          pronunciationOwners.set(sourceText, { rule: pronunciation, sourceProjectId });
          importedPronunciationCount += 1;
          continue;
        }
        if (JSON.stringify(existing.rule) === JSON.stringify(pronunciation)) {
          duplicatePronunciations.push({ source: sourceText, kept_source_project_id: existing.sourceProjectId });
          continue;
        }
        conflictingPronunciations.push({
          source: sourceText,
          kept_source_project_id: existing.sourceProjectId,
          kept_replacement: String(existing.rule.replacement || ''),
          ignored_replacement: String(pronunciation.replacement || ''),
        });
      }
      linkedProjects.push({
        source_project_id: sourceProjectId,
        source_project_title: String(source.title || sourceProjectId),
        imported_at: importedAt,
        roles: importedRoles,
        pronunciations: {
          imported_count: importedPronunciationCount,
          duplicate_rules: duplicatePronunciations,
          conflict_rules: conflictingPronunciations,
        },
      });
    }
    return { roles, characterAssets, voiceFiles: [...new Set(voiceFiles)], pronunciations, linkedProjects };
  }
  const activeJobFile = path.join(jobRoot, 'active-job.json');
  const queueFile = path.join(jobRoot, 'job-queue.json');
  let activeJob;
  let pendingJobs = [];
  let lastModelKey = '';
  let scheduling = false;
  let activeChild;
  const cancelledJobIds = new Set();
  const terminalJobPhases = new Set(['complete', 'error', 'cancelled']);
  await mkdir(jobRoot, { recursive: true });
  try {
    const storedQueue = JSON.parse(await readFile(queueFile, 'utf8'));
    lastModelKey = String(storedQueue.last_model_key || '');
    pendingJobs = (Array.isArray(storedQueue.pending) ? storedQueue.pending : []).map(item => ({
      jobId: safeProjectId(item.jobId),
      kind: String(item.kind),
      projectId: safeProjectId(item.projectId),
      ...(item.roleId ? { roleId: safeProjectId(item.roleId) } : {}),
      modelKey: String(item.modelKey),
      dependencies: (Array.isArray(item.dependencies) ? item.dependencies : []).map(value => safeProjectId(value)),
      createdAt: String(item.createdAt),
    }));
  } catch {}
  let queuePersistChain = Promise.resolve();
  const persistQueue = () => {
    const snapshot = `${JSON.stringify({ version: 1, last_model_key: lastModelKey, pending: pendingJobs }, null, 2)}\n`;
    const operation = queuePersistChain.then(async () => {
      const temporary = `${queueFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, 'utf8');
      await rename(temporary, queueFile);
    });
    queuePersistChain = operation.catch(() => {});
    return operation;
  };
  const projectJobLock = projectId => activeJob?.projectId === projectId
    ? activeJob
    : pendingJobs.find(job => job.projectId === projectId);
  const clearActiveJob = async (jobId) => {
    if (activeJob?.jobId === jobId) activeJob = undefined;
    try {
      const stored = JSON.parse(await readFile(activeJobFile, 'utf8'));
      if (stored.jobId === jobId) await unlink(activeJobFile);
    } catch {}
  };
  try {
    const stored = JSON.parse(await readFile(activeJobFile, 'utf8'));
    const statusFile = path.join(jobRoot, safeProjectId(stored.jobId), 'status.json');
    const status = JSON.parse(await readFile(statusFile, 'utf8'));
    if (terminalJobPhases.has(status.phase)) await unlink(activeJobFile);
    else {
      let processAlive = false;
      if (Number.isSafeInteger(stored.pid) && stored.pid > 0) {
        try { process.kill(stored.pid, 0); processAlive = true; } catch {}
      }
      if (processAlive) activeJob = stored;
      else {
        await writeFile(statusFile, JSON.stringify({ phase: 'error', fraction: 1, message: '服务恢复时未发现原 Worker 进程，任务已经终止，请重新启动' }), 'utf8');
        await unlink(activeJobFile);
      }
    }
  } catch {}
  if (!activeJob) {
    try {
      const runtimeDir = path.join(repoRoot, 'runtime-output', 'render-runtime');
      const runtimeState = JSON.parse(await readFile(path.join(runtimeDir, 'state.json'), 'utf8'));
      const requestId = String(runtimeState.request_id || '');
      if (runtimeState.phase !== 'busy' || !/^[a-f0-9]{32}$/.test(requestId) || !Number.isSafeInteger(runtimeState.pid) || runtimeState.pid <= 0) throw new Error('没有可接管的渲染运行时');
      try { process.kill(runtimeState.pid, 0); } catch { throw new Error('渲染运行时已经退出'); }
      const envelope = JSON.parse(await readFile(path.join(runtimeDir, 'requests', `${requestId}.processing`), 'utf8'));
      const jobDir = path.resolve(path.dirname(String(envelope.status || '')));
      const relativeJobDir = path.relative(path.resolve(jobRoot), jobDir);
      if (!relativeJobDir || relativeJobDir.startsWith('..') || path.isAbsolute(relativeJobDir) || relativeJobDir.includes(path.sep)) throw new Error('渲染任务目录不合法');
      const jobId = safeProjectId(relativeJobDir);
      const expectedStatus = path.join(jobDir, 'status.json');
      const expectedInput = path.join(jobDir, 'input.json');
      if (path.resolve(String(envelope.status || '')) !== expectedStatus || path.resolve(String(envelope.input || '')) !== expectedInput) throw new Error('渲染任务文件不匹配');
      const status = JSON.parse(await readFile(expectedStatus, 'utf8'));
      if (terminalJobPhases.has(status.phase)) throw new Error('渲染任务已经结束');
      const input = JSON.parse(await readFile(expectedInput, 'utf8'));
      const projectId = safeProjectId(input.project_id);
      await access(path.join(projectRoot, projectId, 'project.json'));
      activeJob = {
        jobId,
        kind: input.standard_reference ? 'standardize' : 'render',
        projectId,
        ...(input.standard_reference?.role_id ? { roleId: safeProjectId(input.standard_reference.role_id) } : {}),
        pid: runtimeState.pid,
      };
      await writeFile(activeJobFile, JSON.stringify(activeJob), 'utf8');
    } catch {}
  }
  const recoveredPendingJobs = [];
  for (const job of pendingJobs) {
    try {
      const status = JSON.parse(await readFile(path.join(jobRoot, job.jobId, 'status.json'), 'utf8'));
      if (!terminalJobPhases.has(status.phase)) recoveredPendingJobs.push(job);
    } catch {}
  }
  if (recoveredPendingJobs.length !== pendingJobs.length) {
    pendingJobs = recoveredPendingJobs;
    await persistQueue();
  }
  await app.register(fastifyStatic, { root: distRoot, wildcard: false });

  app.get('/api/health', async () => ({ status: 'ok', productVersion, runtime: process.version, architecture: 'react-antd-node-python', voiceModel: await voiceRuntimeHealth(repoRoot) }));
  app.get('/api/active-job', async () => {
    if (!activeJob) return { available: false };
    try {
      const status = JSON.parse(await readFile(path.join(jobRoot, activeJob.jobId, 'status.json'), 'utf8'));
      if (terminalJobPhases.has(status.phase)) {
        lastModelKey = activeJob.modelKey || lastModelKey;
        await clearActiveJob(activeJob.jobId);
        await persistQueue();
        void scheduleQueue();
        return { available: false };
      }
      return { available: true, ...activeJob, ...status };
    } catch {
      const failed = activeJob;
      await clearActiveJob(failed.jobId);
      return { available: false };
    }
  });
  app.get('/api/presets', async () => presets);
  app.get('/api/settings/ai-media', async () => publicAiMediaSettings(await readAiMediaSettings(aiMediaSettingsFile)));
  app.post('/api/settings/ai-media/test', async (request, reply) => {
    const signal = requestAbortSignal(request, reply);
    try {
      const current = await readAiMediaSettings(aiMediaSettingsFile);
      const endpoint = normalizeAiEndpoint(request.body?.endpoint || current.endpoint);
      const apiKey = String(request.body?.apiKey || current.api_key || '').trim();
      if (!endpoint) throw new Error('请先填写 OpenAI 兼容 Endpoint');
      if (!apiKey) throw new Error('请先填写或保存 API Key');
      const settings = {
        ...current,
        endpoint,
        api_key: apiKey,
        instance_id: String(request.body?.instanceId ?? current.instance_id ?? '').trim(),
        allow_insecure_http: Boolean(request.body?.allowInsecureHttp ?? current.allow_insecure_http),
      };
      const models = await discoverCompatibleModels(remoteFetch, settings, signal);
      return { ok: true, endpoint, instanceId: settings.instance_id, models, modelCount: models.length };
    } catch (error) { return reply.code(requestErrorStatus(error)).send({ error: error.message }); }
  });
  app.post('/api/settings/ai-media/director-test', async (request, reply) => {
    const signal = requestAbortSignal(request, reply);
    try {
      const current = await readAiMediaSettings(aiMediaSettingsFile);
      const provider = ['ollama', 'compatible'].includes(request.body?.directorProvider) ? request.body.directorProvider : current.director_provider;
      if (provider === 'ollama') {
        const endpoint = normalizeOllamaEndpoint(request.body?.ollamaEndpoint || current.ollama_endpoint);
        const models = await discoverOllamaModels(remoteFetch, endpoint, signal);
        return { ok: true, provider, endpoint, models, modelCount: models.length };
      }
      const endpoint = normalizeAiEndpoint(request.body?.endpoint || current.endpoint);
      const apiKey = String(request.body?.apiKey || current.api_key || '').trim();
      if (!endpoint || !apiKey) throw new Error('兼容全文分析需要 Endpoint 和 API Key');
      const settings = {
        ...current,
        endpoint,
        api_key: apiKey,
        instance_id: String(request.body?.instanceId ?? current.instance_id ?? '').trim(),
        allow_insecure_http: Boolean(request.body?.allowInsecureHttp ?? current.allow_insecure_http),
      };
      const models = await discoverCompatibleModels(remoteFetch, settings, signal);
      return { ok: true, provider, endpoint, models, modelCount: models.length };
    } catch (error) { return reply.code(requestErrorStatus(error)).send({ error: error.message }); }
  });
  app.put('/api/settings/ai-media', async (request, reply) => {
    try {
      const current = await readAiMediaSettings(aiMediaSettingsFile);
      const endpoint = normalizeAiEndpoint(request.body?.endpoint);
      const textModel = String(request.body?.textModel || '').trim();
      const directorProvider = request.body?.directorProvider === 'compatible' ? 'compatible' : 'ollama';
      const directorModel = String(request.body?.directorModel || '').trim() || 'qwen3:14b';
      const ollamaEndpoint = normalizeOllamaEndpoint(request.body?.ollamaEndpoint);
      const directorMaxChunkChars = Math.max(320, Math.min(12000, Math.round(Number(request.body?.directorMaxChunkChars) || 1400)));
      const imageModel = String(request.body?.imageModel || '').trim();
      const imageFallbackModel = String(request.body?.imageFallbackModel || '').trim();
      const imageFallbackRequested = Boolean(request.body?.imageFallbackEnabled);
      const imageFallbackEnabled = Boolean(imageFallbackRequested && imageFallbackModel && imageFallbackModel !== imageModel);
      const instanceId = String(request.body?.instanceId || '').trim();
      const textApi = request.body?.textApi === 'responses' ? 'responses' : 'chat_completions';
      const allowInsecureHttp = Boolean(request.body?.allowInsecureHttp);
      const apiKey = request.body?.clearApiKey ? '' : String(request.body?.apiKey || current.api_key || '').trim();
      if (endpoint && !textModel) throw new Error('请填写人物小传模型名称');
      if (endpoint && !imageModel) throw new Error('请填写图像模型名称');
      if (imageFallbackRequested && !imageFallbackModel) throw new Error('启用冷却切换时请填写互补图像模型');
      if (imageFallbackRequested && imageFallbackModel === imageModel) throw new Error('互补图像模型必须与主图像模型不同');
      if (directorProvider === 'compatible' && (!endpoint || !apiKey)) throw new Error('兼容全文分析需要 Endpoint 和 API Key');
      const stored = { endpoint, api_key: apiKey, text_model: textModel || 'gemini-2.5-pro', director_provider: directorProvider, director_model: directorModel, ollama_endpoint: ollamaEndpoint, director_max_chunk_chars: directorMaxChunkChars, image_model: imageModel || 'gpt-image-1', image_fallback_model: imageFallbackModel, image_fallback_enabled: imageFallbackEnabled, instance_id: instanceId, text_api: textApi, allow_insecure_http: allowInsecureHttp };
      const temporary = `${aiMediaSettingsFile}.tmp`;
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
      await rename(temporary, aiMediaSettingsFile);
      return publicAiMediaSettings(stored);
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });
  app.get('/api/voices/:voiceId/audio', async (request, reply) => {
    try {
      const voiceId = safeProjectId(request.params.voiceId);
      const stem = voiceId.replace(/\.wav$/i, '');
      const candidates = [];
      if (/^(voice-|legacy-)[\w-]+$/i.test(stem)) candidates.push(path.join(repoRoot, 'outputs', 'voice-library', `${stem}.wav`));
      if (/^voice_\d+\.wav$/i.test(voiceId)) candidates.push(path.join(repoRoot, 'examples', voiceId));
      let file;
      for (const candidate of candidates) {
        try { await access(candidate); file = candidate; break; } catch {}
      }
      if (!file) return reply.code(404).send({ error: '音色音频不存在' });
      const info = await stat(file);
      const range = String(request.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
      reply.type('audio/wav').header('Accept-Ranges', 'bytes');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
          return reply.code(416).header('Content-Range', `bytes */${info.size}`).send();
        }
        reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`).header('Content-Length', end - start + 1);
        return reply.send(createReadStream(file, { start, end }));
      }
      reply.header('Content-Length', info.size);
      return reply.send(createReadStream(file));
    } catch { return reply.code(404).send({ error: '音色音频不存在' }); }
  });
  app.get('/api/projects', async () => {
    const entries = await readdir(projectRoot, { withFileTypes: true });
    const projects = [];
    for (const entry of entries.filter(item => item.isDirectory())) {
      try {
        const payload = JSON.parse(await readFile(path.join(projectRoot, entry.name, 'project.json'), 'utf8'));
        projects.push({ label: `${payload.title || entry.name}  ${entry.name}`, value: entry.name, roleCount: Array.isArray(payload.roles) ? payload.roles.length : 0, updated: payload.updated_at || '' });
      } catch {}
    }
    return projects.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  });
  app.post('/api/projects', async (request, reply) => {
    try {
      const title = String(request.body?.title || '').trim();
      const contentType = String(request.body?.content_type || 'auto');
      if (!title) throw new Error('请填写工程名称');
      if (!['auto', 'novel', 'news', 'commentary', 'story'].includes(contentType)) throw new Error('作品体裁无效');
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const id = safeProjectId(`${stamp}-${safeSlug(title)}-${randomUUID().slice(0, 6)}`);
      const now = new Date().toISOString();
      const imported = await importLinkedProjectRoles(request.body?.source_project_ids, now);
      const dir = path.join(projectRoot, id);
      await Promise.all(['voices', 'process', 'renders', 'analysis'].map(name => mkdir(path.join(dir, name), { recursive: true })));
      const payload = { version: 1, project_id: id, title, content_type: contentType, source_text: '', guidance: '', chapters: [], document: {}, roles: imported.roles, character_assets: imported.characterAssets, segments: [], pronunciations: imported.pronunciations, director_history: [], director_memory: { source_text: '', roles: structuredClone(imported.roles), character_assets: structuredClone(imported.characterAssets), segments: [], pronunciations: structuredClone(imported.pronunciations) }, voice_files: imported.voiceFiles, linked_projects: imported.linkedProjects, created_at: now, updated_at: now };
      await writeFile(path.join(dir, 'project.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      return reply.code(201).send(payload);
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });
  app.get('/api/projects/:id', async (request, reply) => {
    try {
      const projectPath = path.join(projectRoot, safeProjectId(request.params.id), 'project.json');
      const project = JSON.parse(await readFile(projectPath, 'utf8'));
      if (await reconcileRoleVoiceFiles(project)) {
        const temporary = `${projectPath}.tmp`;
        await writeFile(temporary, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
        await rename(temporary, projectPath);
      }
      return projectForClient(normalizeProject(project));
    }
    catch (error) { return reply.code(404).send({ error: error.message || '工程不存在' }); }
  });
  app.put('/api/projects/:id', { bodyLimit: 64 * 1024 * 1024 }, async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const projectLock = projectJobLock(id);
      if (projectLock) {
        const error = new Error(`工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成`);
        error.statusCode = 409;
        throw error;
      }
      const currentPath = path.join(projectRoot, id, 'project.json');
      await access(currentPath);
      const current = normalizeProject(JSON.parse(await readFile(currentPath, 'utf8')));
      const payload = validateProject(normalizeChapterSections(request.body), id);
      await reconcileRoleVoiceFiles(payload);
      const directorChanges = directorChangeKinds(directorSnapshot(current), directorSnapshot(payload));
      preserveDirectorOperations(current, payload);
      payload.artifact_invalidation = await invalidateDirectorArtifacts(path.join(projectRoot, id), current, payload, directorChanges);
      payload.updated_at = new Date().toISOString();
      const temporary = `${currentPath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await rename(temporary, currentPath);
      return projectForClient(payload);
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.put('/api/projects/:id/roles/:roleId/reference-audio', { bodyLimit: 25 * 1024 * 1024 }, async (request, reply) => {
    const temporaryFiles = [];
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      const projectLock = projectJobLock(id);
      if (projectLock) return reply.code(409).send({ error: `工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成` });
      const projectDir = path.join(projectRoot, id);
      await access(path.join(projectDir, 'project.json'));
      const bytes = request.body;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('请选择参考音频文件');
      if (bytes.length > 25 * 1024 * 1024) throw new Error('参考音频不能超过 25 MB');
      const sourceFormat = referenceAudioFormat(bytes);
      const encodedName = String(request.headers['x-audio-filename'] || '');
      let decodedName = encodedName;
      try { decodedName = decodeURIComponent(encodedName); } catch {}
      const originalName = path.basename(decodedName.replaceAll('\\', '/')).slice(0, 255) || `reference.${sourceFormat}`;
      const voiceId = `voice-upload-${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
      const processDir = path.join(projectDir, 'process');
      const voiceDir = path.join(repoRoot, 'outputs', 'voice-library');
      await Promise.all([mkdir(processDir, { recursive: true }), mkdir(voiceDir, { recursive: true })]);
      const nonce = randomUUID();
      const sourcePath = path.join(processDir, `reference-${nonce}.${sourceFormat}`);
      const convertedPath = path.join(processDir, `reference-${nonce}.normalized.wav`);
      temporaryFiles.push(sourcePath, convertedPath);
      await writeFile(sourcePath, bytes);
      await convertReferenceAudio(sourcePath, convertedPath);
      const convertedInfo = await stat(convertedPath);
      if (!convertedInfo.isFile() || convertedInfo.size <= 44) throw new Error('参考音频转换后没有有效声音数据');
      const permanentAudio = path.join(voiceDir, `${voiceId}.wav`);
      try { await access(permanentAudio); }
      catch { await rename(convertedPath, permanentAudio); }
      const uploadedAt = new Date().toISOString();
      const metadata = {
        voice_id: voiceId,
        source: 'uploaded_reference_audio',
        original_name: originalName,
        uploaded_at: uploadedAt,
        source_format: sourceFormat,
        source_size_bytes: bytes.length,
        sample_rate_hz: 24000,
        channels: 1,
        maximum_source_seconds: 60,
      };
      await writeFile(path.join(voiceDir, `${voiceId}.json`), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      return {
        voiceId,
        originalName,
        uploadedAt,
        sourceFormat,
        sizeBytes: bytes.length,
        sampleRateHz: 24000,
        channels: 1,
        maximumSourceSeconds: 60,
      };
    } catch (error) {
      request.log.error({ err: error }, 'reference audio upload failed');
      return reply.code(error.code === 'ENOENT' ? 404 : (error.statusCode || 400)).send({ error: error.code === 'ENOENT' ? '工程不存在' : error.message });
    } finally {
      await Promise.all(temporaryFiles.map(file => rm(file, { force: true }).catch(() => {})));
    }
  });
  app.delete('/api/projects/:id', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const projectLock = projectJobLock(id);
      if (projectLock) {
        const error = new Error(`工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成`);
        error.statusCode = 409;
        throw error;
      }
      const projectsDir = path.resolve(projectRoot);
      const target = path.resolve(projectRoot, id);
      if (path.dirname(target) !== projectsDir) throw new Error('工程路径无效');
      const info = await stat(path.join(target, 'project.json'));
      if (!info.isFile()) throw new Error('工程记录无效');
      await rm(target, { recursive: true, force: false });
      return { deleted: true, projectId: id };
    } catch (error) {
      const statusCode = error.statusCode || (error.code === 'ENOENT' ? 404 : 400);
      return reply.code(statusCode).send({ error: error.code === 'ENOENT' ? '工程不存在' : error.message });
    }
  });
  app.post('/api/projects/:id/roles/:roleId/expand-profile', async (request, reply) => {
    const signal = requestAbortSignal(request, reply);
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      const projectLock = projectJobLock(id);
      if (projectLock) return reply.code(409).send({ error: `工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成` });
      const settings = await readAiMediaSettings(aiMediaSettingsFile);
      if (!settings.endpoint || !settings.api_key || !settings.text_model) throw new Error('请先在系统配置中填写兼容服务 Endpoint、API Key 和人物小传模型');
      const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
      const role = project.roles.find(row => String(row[0]) === roleId);
      if (!role) throw new Error('角色不存在');
      const name = String(request.body?.name || role[1]).trim();
      const currentProfile = String(request.body?.profile || role[3]).trim();
      const gender = String(request.body?.gender || project.character_assets[roleId]?.gender || 'unspecified');
      const age = Math.max(5, Math.min(100, Math.round(Number(request.body?.age) || project.character_assets[roleId]?.age || 35)));
      const evidence = characterEvidence(project.source_text, name);
      const systemPrompt = '你是长篇声音作品的人物设定导演。只使用稿件证据与用户已确认设定，写一篇具体、可复用、适合声音设计和视觉形象生成的人物小传。未知信息明确写“稿件未说明”，不得虚构关键事实。输出纯中文正文，不使用标题、列表或 Markdown。';
      const userPrompt = `角色：${name}\n年龄设定：约 ${age} 岁\n性别设定：${gender}\n当前小传：${currentProfile}\n稿件相关证据：\n${evidence}\n\n请在 300 至 600 个中文字符内覆盖身份与社会位置、外貌线索、年龄气质、人物关系、经历、欲望与矛盾、性格与行为习惯、说话方式、叙事作用，并区分稿件事实与未知信息。`;
      const response = settings.text_api === 'responses'
        ? await callCompatibleJson(remoteFetch, aiRoute(settings.endpoint, '/responses'), settings, { model: settings.text_model, instructions: systemPrompt, input: userPrompt, stream: false }, signal)
        : await callCompatibleJson(remoteFetch, aiRoute(settings.endpoint, '/chat/completions'), settings, { model: settings.text_model, temperature: 0.35, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }] }, signal);
      const profile = extractCompatibleText(response);
      if (profile.length < 80) throw new Error('兼容服务返回的人物小传过短，请检查模型配置');
      return { profile, model: settings.text_model };
    } catch (error) { return reply.code(requestErrorStatus(error)).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/roles/:roleId/portrait', async (request, reply) => {
    const signal = requestAbortSignal(request, reply);
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      const projectLock = projectJobLock(id);
      if (projectLock) return reply.code(409).send({ error: `工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成` });
      const settings = await readAiMediaSettings(aiMediaSettingsFile);
      if (!settings.endpoint || !settings.api_key || !settings.image_model) throw new Error('请先在系统配置中填写兼容服务 Endpoint、API Key 和图像模型');
      const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
      const role = project.roles.find(row => String(row[0]) === roleId);
      if (!role) throw new Error('角色不存在');
      const draft = {
        name: String(request.body?.name || role[1]).trim(),
        profile: String(request.body?.profile || role[3]).trim(),
        gender: String(request.body?.gender || project.character_assets[roleId]?.gender || 'unspecified'),
        age: Math.max(5, Math.min(100, Math.round(Number(request.body?.age) || project.character_assets[roleId]?.age || 35))),
        portraitStyle: normalizePortraitStyle(request.body?.portraitStyle || project.character_assets[roleId]?.portrait_style),
        portraitPrompt: String(request.body?.portraitPrompt ?? project.character_assets[roleId]?.portrait_notes ?? '').trim(),
      };
      if (draft.profile.length < 20) throw new Error('人物小传至少填写 20 个字符后才能生成形象');
      const basePrompt = portraitPrompt(draft);
      const routed = await runWithImageModelFallback({
        settings,
        requestedModel: request.body?.imageModel,
        allowFallback: request.body?.allowFallback !== false,
        cooldowns: imageModelCooldowns,
        execute: async model => {
          const prompt = adaptImagePrompt(basePrompt, model, 'portrait');
          const response = await callCompatibleJson(remoteFetch, aiRoute(settings.endpoint, '/images/generations'), settings, {
            model, prompt, size: '1024x1024', n: 1, response_format: 'b64_json',
          }, signal);
          const item = response?.data?.[0] || response?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData || part?.inline_data);
          const bytes = await decodeCompatibleImage(remoteFetch, item, settings, signal);
          return { bytes, prompt };
        },
      });
      const { bytes, prompt } = routed.value;
      throwIfAborted(signal);
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('兼容服务返回的图像为空或超过 20 MB');
      const extension = imageExtension(bytes);
      const assetsDir = path.join(projectRoot, id, 'role-assets');
      await mkdir(assetsDir, { recursive: true });
      const filename = `${safeSlug(roleId)}-${Date.now()}${extension}`;
      await writeFile(path.join(assetsDir, filename), bytes);
      return {
        portraitUrl: `/api/projects/${encodeURIComponent(id)}/role-assets/${encodeURIComponent(filename)}`,
        portraitPrompt: prompt,
        portraitStyle: draft.portraitStyle,
        model: routed.actualModel,
        requestedModel: routed.requestedModel,
        modelFallbackUsed: routed.fallbackUsed,
        modelFallbackReason: routed.fallbackReason,
        modelPromptProfile: routed.promptProfile,
      };
    } catch (error) { return reply.code(requestErrorStatus(error)).send({ error: error.message }); }
  });
  app.get('/api/projects/:id/role-assets/:file', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const file = safeProjectId(request.params.file);
      const assetPath = path.join(projectRoot, id, 'role-assets', file);
      const info = await stat(assetPath);
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      reply.type(type).header('Content-Length', info.size).header('Cache-Control', 'private, max-age=3600');
      return reply.send(createReadStream(assetPath));
    } catch { return reply.code(404).send({ error: '角色形象不存在' }); }
  });
  app.post('/api/projects/:id/scenes/:sceneId/keyframe', async (request, reply) => {
    const signal = requestAbortSignal(request, reply);
    try {
      const id = safeProjectId(request.params.id);
      const sceneId = safeProjectId(request.params.sceneId);
      const projectLock = projectJobLock(id);
      if (projectLock) return reply.code(409).send({ error: `工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成` });
      const settings = await readAiMediaSettings(aiMediaSettingsFile);
      if (!settings.endpoint || !settings.api_key || !settings.image_model) throw new Error('请先在系统配置中填写兼容服务 Endpoint、API Key 和图像模型');
      const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
      const persistedScenes = Array.isArray(project.document?.scenes) ? project.document.scenes : [];
      const persistedScene = persistedScenes.find(scene => String(scene?.id || '') === sceneId);
      if (!persistedScene) throw new Error('场景不存在');
      const draft = request.body?.scene && typeof request.body.scene === 'object'
        ? { ...persistedScene, ...request.body.scene, id: sceneId }
        : persistedScene;
      return await generateSceneKeyframe({
        remoteFetch,
        settings,
        projectRoot,
        projectId: id,
        project,
        scene: draft,
        requestedStyle: request.body?.keyframeStyle,
        requestedModel: request.body?.imageModel,
        allowFallback: request.body?.allowFallback !== false,
        imageModelCooldowns,
        signal,
      });
    } catch (error) { return reply.code(requestErrorStatus(error)).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/scenes/:sceneId/shots/:shotId/keyframe', async (request, reply) => {
    const signal = requestAbortSignal(request, reply);
    try {
      const id = safeProjectId(request.params.id);
      const sceneId = safeProjectId(request.params.sceneId);
      const shotId = safeProjectId(request.params.shotId);
      const projectLock = projectJobLock(id);
      if (projectLock) return reply.code(409).send({ error: `工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成` });
      const settings = await readAiMediaSettings(aiMediaSettingsFile);
      if (!settings.endpoint || !settings.api_key || !settings.image_model) throw new Error('请先在系统配置中填写兼容服务 Endpoint、API Key 和图像模型');
      const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
      const persistedScene = (Array.isArray(project.document?.scenes) ? project.document.scenes : []).find(scene => String(scene?.id || '') === sceneId);
      if (!persistedScene) throw new Error('场景不存在');
      const persistedShot = (Array.isArray(persistedScene.shots) ? persistedScene.shots : []).find(shot => String(shot?.id || '') === shotId);
      if (!persistedShot) throw new Error('分镜镜头不存在');
      const requestedShot = request.body?.shot && typeof request.body.shot === 'object' ? request.body.shot : {};
      const draft = { ...persistedScene, ...persistedShot, ...requestedShot, id: shotId, scene_id: sceneId, participants: requestedShot.participants || persistedShot.participants || persistedScene.participants };
      const generated = await generateSceneKeyframe({
        remoteFetch,
        settings,
        projectRoot,
        projectId: id,
        project,
        scene: draft,
        requestedStyle: request.body?.keyframeStyle,
        requestedModel: request.body?.imageModel,
        allowFallback: request.body?.allowFallback !== false,
        imageModelCooldowns,
        signal,
      });
      return { ...generated, shotId };
    } catch (error) { return reply.code(requestErrorStatus(error)).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/storyboard/keyframes', async (request, reply) => {
    const signal = requestAbortSignal(request, reply);
    try {
      const id = safeProjectId(request.params.id);
      const projectLock = projectJobLock(id);
      if (projectLock) return reply.code(409).send({ error: `工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成` });
      const settings = await readAiMediaSettings(aiMediaSettingsFile);
      if (!settings.endpoint || !settings.api_key || !settings.image_model) throw new Error('请先在系统配置中填写兼容服务 Endpoint、API Key 和图像模型');
      const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
      const persistedScenes = Array.isArray(project.document?.scenes) ? project.document.scenes : [];
      const requestedShots = Array.isArray(request.body?.shots) ? request.body.shots : undefined;
      if (requestedShots) {
        if (!requestedShots.length) throw new Error('当前工程没有可生成的分镜镜头');
        if (requestedShots.length > 500) throw new Error('单次全量关键帧生成最多处理 500 个分镜镜头');
        const persistedShots = new Map();
        for (const scene of persistedScenes) for (const shot of Array.isArray(scene?.shots) ? scene.shots : []) persistedShots.set(String(shot?.id || ''), { scene, shot });
        const preparedShots = requestedShots.map(shot => {
          const shotId = safeProjectId(shot?.id);
          const persisted = persistedShots.get(shotId);
          if (!persisted) throw new Error(`分镜镜头 ${shotId} 不存在`);
          return { ...persisted.scene, ...persisted.shot, ...(shot && typeof shot === 'object' ? shot : {}), id: shotId, scene_id: String(persisted.scene.id), participants: shot.participants || persisted.shot.participants || persisted.scene.participants };
        });
        const selectedModels = imageModelCandidates(settings, request.body?.imageModel, request.body?.allowFallback !== false);
        for (const shot of preparedShots) await resolveSceneCharacterReferences(projectRoot, project, shot);
        if (request.body?.preflightOnly === true) {
          return { validatedCount: preparedShots.length, shotIds: preparedShots.map(shot => String(shot.id)), model: selectedModels[0], candidateModels: selectedModels };
        }
        const keyframes = [];
        for (const shot of preparedShots) {
          const generated = await generateSceneKeyframe({
            remoteFetch,
            settings,
            projectRoot,
            projectId: id,
            project,
            scene: shot,
            requestedStyle: request.body?.keyframeStyle,
            requestedModel: request.body?.imageModel,
            allowFallback: request.body?.allowFallback !== false,
            imageModelCooldowns,
            signal,
          });
          keyframes.push({ ...generated, shotId: String(shot.id) });
        }
        return { keyframes, generatedCount: keyframes.length, model: selectedModels[0], candidateModels: selectedModels };
      }
      const requestedScenes = Array.isArray(request.body?.scenes) ? request.body.scenes : persistedScenes;
      if (!requestedScenes.length) throw new Error('当前工程没有可生成的分镜场景');
      if (requestedScenes.length > 200) throw new Error('单次全量关键帧生成最多处理 200 个场景');
      const persistedById = new Map(persistedScenes.map(scene => [String(scene?.id || ''), scene]));
      const prepared = requestedScenes.map(scene => {
        const sceneId = safeProjectId(scene?.id);
        const persisted = persistedById.get(sceneId);
        if (!persisted) throw new Error(`场景 ${sceneId} 不存在`);
        return { ...persisted, ...(scene && typeof scene === 'object' ? scene : {}), id: sceneId };
      });
      for (const scene of prepared) await resolveSceneCharacterReferences(projectRoot, project, scene);
      const keyframes = [];
      for (const scene of prepared) {
        keyframes.push(await generateSceneKeyframe({
          remoteFetch,
          settings,
          projectRoot,
          projectId: id,
          project,
          scene,
          requestedStyle: request.body?.keyframeStyle,
          requestedModel: request.body?.imageModel,
          allowFallback: request.body?.allowFallback !== false,
          imageModelCooldowns,
          signal,
        }));
      }
      return { keyframes, generatedCount: keyframes.length, model: String(request.body?.imageModel || settings.image_model) };
    } catch (error) { return reply.code(requestErrorStatus(error)).send({ error: error.message }); }
  });
  app.get('/api/projects/:id/scene-assets/:file', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const file = safeProjectId(request.params.file);
      const assetPath = path.join(projectRoot, id, 'scene-assets', file);
      const info = await stat(assetPath);
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      reply.type(type).header('Content-Length', info.size).header('Cache-Control', 'private, max-age=3600');
      return reply.send(createReadStream(assetPath));
    } catch { return reply.code(404).send({ error: '场景关键帧不存在' }); }
  });
  app.get('/api/projects/:id/latest-render', async (request) => {
    const id = safeProjectId(request.params.id);
    const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
    const name = await latestRender(path.join(projectRoot, id));
    const base = name ? `/api/projects/${encodeURIComponent(id)}/render-file/${encodeURIComponent(name)}` : '';
    let fragments = [];
    let draftFragments = [];
    const captions = await renderCaptions(path.join(projectRoot, id), name);
    let stale;
    try { stale = JSON.parse(await readFile(path.join(projectRoot, id, 'renders', name, '.stale.json'), 'utf8')); } catch {}
    if (name) try {
      const manifest = JSON.parse(await readFile(path.join(projectRoot, id, 'renders', name, 'director-manifest.json'), 'utf8'));
      const invalidated = new Set(stale?.invalidated_cache_keys || []);
      const manifestSegments = manifest.segments || [];
      fragments = manifestSegments.filter(item => !invalidated.has(item.cache_key)).map(item => ({
        order: Number(item.order), speakerName: String(item.speaker_name || ''), sourceText: String(item.source_text || ''),
        synthesisText: String(item.text || ''), effectiveText: String(item.effective_text || item.text || ''),
        appliedPronunciations: item.applied_pronunciations || [], cacheReused: Boolean(item.cache_reused),
        forcedRegeneration: Boolean(item.forced_regeneration), audio: `${base}/segments/${encodeURIComponent(path.basename(String(item.audio || '').replaceAll('\\', '/')))}`,
      }));
    } catch {}
    try {
      const draft = JSON.parse(await readFile(path.join(projectRoot, id, 'process', 'segment-fragments.json'), 'utf8'));
      draftFragments = Object.entries(draft.fragments || {}).map(([cacheKey, item]) => ({
        order: Number(item.order), speakerName: String(item.speaker_name || ''), sourceText: String(item.source_text || ''),
        synthesisText: String(item.text || ''), effectiveText: String(item.effective_text || item.text || ''),
        appliedPronunciations: item.applied_pronunciations || [], cacheReused: false, forcedRegeneration: true,
        audio: `/api/projects/${encodeURIComponent(id)}/cached-fragments/${cacheKey}`,
        stressWord: String(item.stress_word || ''), stressLevel: String(item.stress_level || 'none'), selectedCandidateId: String(item.selected_candidate_id || ''),
        candidates: (item.candidate_results || []).map(candidate => ({
          candidateId: String(candidate.candidate_id), rank: Number(candidate.rank), selected: Boolean(candidate.selected),
          score: Number(candidate.score), stressDb: Number(candidate.stress_db), audioQualityPassed: Boolean(candidate.audio_quality_passed),
          qualityPassed: Boolean(candidate.quality_passed && candidate.audio_quality_passed && candidate.speaker_verified),
          stressVerified: Boolean(candidate.stress_verified), alignmentMethod: String(candidate.alignment_method || ''),
          speakerSimilarity: candidate.speaker_similarity == null ? null : Number(candidate.speaker_similarity),
          speakerSimilarityThreshold: Number(candidate.speaker_similarity_threshold || 0.72),
          speakerVerified: Boolean(candidate.speaker_verified), speakerValidationMethod: String(candidate.speaker_validation_method || ''),
          directorVerified: Boolean(candidate.director_verified), directorValidationMethod: String(candidate.director_validation_method || ''),
          manualOverride: Boolean(candidate.manual_override), manualSelectedAt: String(candidate.manual_selected_at || ''),
          audio: `/api/projects/${encodeURIComponent(id)}/cached-fragment-candidates/${cacheKey}/${encodeURIComponent(String(candidate.candidate_id))}`,
        })),
      }));
    } catch {}
    fragments = reconcileFragmentsToProject(fragments, draftFragments, project.segments);
    return { available: Boolean(name), ...(name ? { renderId: name, audio: `${base}/audio`, mp3: `${base}/mp3`, package: `${base}/package`, manifest: `${base}/manifest` } : {}), fragments, captions, stale: Boolean(stale?.stale), staleAt: stale?.stale_at, staleReasons: stale?.reasons || [] };
  });
  app.delete('/api/projects/:id/renders/:renderId', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const renderId = safeProjectId(request.params.renderId);
      const projectLock = projectJobLock(id);
      if (projectLock) {
        const error = new Error(`工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成`);
        error.statusCode = 409;
        throw error;
      }
      const rendersDir = path.resolve(projectRoot, id, 'renders');
      const target = path.resolve(rendersDir, renderId);
      if (path.dirname(target) !== rendersDir) throw new Error('交付记录路径无效');
      const info = await stat(target);
      if (!info.isDirectory()) throw new Error('交付记录不是目录');
      await rm(target, { recursive: true, force: false });
      return { deleted: true, renderId };
    } catch (error) {
      const statusCode = error.statusCode || (error.code === 'ENOENT' ? 404 : 400);
      return reply.code(statusCode).send({ error: error.code === 'ENOENT' ? '交付记录不存在' : error.message });
    }
  });
  async function queuedStatusMap() {
    const ids = new Set(pendingJobs.flatMap(job => job.dependencies || []));
    const statuses = {};
    await Promise.all([...ids].map(async jobId => {
      try { statuses[jobId] = JSON.parse(await readFile(path.join(jobRoot, jobId, 'status.json'), 'utf8')).phase; }
      catch { statuses[jobId] = 'missing'; }
    }));
    return statuses;
  }

  async function refreshQueuedStatuses() {
    const statuses = await queuedStatusMap();
    await Promise.all(pendingJobs.map(async (job, index) => {
      const blocked = job.dependencies.some(jobId => statuses[jobId] !== 'complete');
      const message = blocked ? `等待依赖任务完成：${job.dependencies.filter(jobId => statuses[jobId] !== 'complete').join('、')}` : `等待模型调度：${job.modelKey}`;
      await writeFile(path.join(jobRoot, job.jobId, 'status.json'), JSON.stringify({
        phase: 'queued', fraction: 0, message, modelKey: job.modelKey, dependencies: job.dependencies, queuePosition: index + 1,
      }), 'utf8');
    }));
  }

  async function launchPreparedJob(job) {
    const dir = path.join(jobRoot, job.jobId);
    const input = path.join(dir, 'input.json');
    const status = path.join(dir, 'status.json');
    const result = path.join(dir, 'result.json');
    const worker = job.kind === 'analyze' || job.kind === 'storyboard' ? 'product_analysis_worker.py' : job.kind === 'voice' ? 'product_voice_worker.py' : 'product_render_worker.py';
    activeJob = { ...job };
    await writeFile(status, JSON.stringify({ phase: 'queued', fraction: 0, message: `模型队列已选中任务：${job.modelKey}`, modelKey: job.modelKey, dependencies: job.dependencies, queuePosition: 0 }), 'utf8');
    await writeFile(activeJobFile, JSON.stringify(activeJob), 'utf8');
    const python = workerPython(repoRoot);
    const workerArgs = [path.join(repoRoot, worker), '--input', input, '--result', result, '--status', status];
    const child = launchWorker
      ? launchWorker({ python, args: workerArgs, cwd: repoRoot, env: { ...process.env, PYTHONUTF8: '1' } })
      : spawnWorker(python, workerArgs, {
        cwd: repoRoot, detached: false, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' },
      });
    activeChild = { jobId: job.jobId, child };
    const log = path.join(dir, 'worker.log');
    const chunks = [];
    let settled = false;
    const finish = async (code, spawnError) => {
      if (settled) return;
      settled = true;
      try {
        const logText = Buffer.concat(chunks).toString('utf8');
        await writeFile(log, logText, 'utf8');
        let prior = {};
        try { prior = JSON.parse(await readFile(status, 'utf8')); } catch {}
        if (cancelledJobIds.has(job.jobId)) {
          await writeFile(status, JSON.stringify({ phase: 'cancelled', fraction: Number(prior.fraction) || 0, message: '任务已由用户取消', modelKey: job.modelKey, dependencies: job.dependencies }), 'utf8');
        } else if (spawnError) {
          await writeFile(status, JSON.stringify({ phase: 'error', fraction: 1, message: `Worker 启动失败：${spawnError.message}`, modelKey: job.modelKey, dependencies: job.dependencies }), 'utf8');
        } else if (code && code !== 0) {
          const workerDetail = logText.trim().split(/\r?\n/u).at(-1);
          const detail = String(prior.phase === 'error' && prior.message ? prior.message : workerDetail || `Worker 退出码 ${code}`);
          await writeFile(status, JSON.stringify({ phase: 'error', fraction: 1, message: detail, modelKey: job.modelKey, dependencies: job.dependencies }), 'utf8');
        } else if (!terminalJobPhases.has(prior.phase)) {
          await writeFile(status, JSON.stringify({ phase: 'error', fraction: 1, message: 'Worker 已退出，但没有写入完成状态', modelKey: job.modelKey, dependencies: job.dependencies }), 'utf8');
        }
      } finally {
        if (job.kind === 'standardize') {
          await rm(path.join(projectRoot, job.projectId, 'process', 'standard-reference-staging'), { recursive: true, force: true }).catch(() => {});
        }
        if (activeChild?.jobId === job.jobId) activeChild = undefined;
        cancelledJobIds.delete(job.jobId);
        lastModelKey = job.modelKey;
        await clearActiveJob(job.jobId);
        await persistQueue();
        void scheduleQueue();
      }
    };
    child.stdout?.on('data', chunk => chunks.push(chunk));
    child.stderr?.on('data', chunk => chunks.push(chunk));
    child.on('close', code => { void finish(code); });
    child.on('error', error => { void finish(undefined, error); });
    if (!launchWorker) {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    }
    activeJob.pid = Number.isSafeInteger(child.pid) ? child.pid : undefined;
    await writeFile(activeJobFile, JSON.stringify(activeJob), 'utf8');
  }

  async function scheduleQueue() {
    if (scheduling) return;
    scheduling = true;
    try {
      if (activeJob) {
        await refreshQueuedStatuses();
        return;
      }
      while (!activeJob && pendingJobs.length) {
        const statuses = await queuedStatusMap();
        const classified = classifyPendingJobs(pendingJobs, statuses, lastModelKey);
        if (classified.failed.length) {
          const failedIds = new Set(classified.failed.map(item => item.job.jobId));
          for (const { job, failedDependency, dependencyStatus } of classified.failed) {
            const reason = dependencyStatus === 'missing' ? '状态记录缺失' : '未成功';
            await writeFile(path.join(jobRoot, job.jobId, 'status.json'), JSON.stringify({ phase: 'error', fraction: 1, message: `依赖任务 ${failedDependency} ${reason}，当前任务已终止`, modelKey: job.modelKey, dependencies: job.dependencies }), 'utf8');
          }
          pendingJobs = pendingJobs.filter(job => !failedIds.has(job.jobId));
          await persistQueue();
          continue;
        }
        if (!classified.next) break;
        const next = classified.next;
        pendingJobs = pendingJobs.filter(job => job.jobId !== next.jobId);
        await persistQueue();
        try { await launchPreparedJob(next); }
        catch (error) {
          await writeFile(path.join(jobRoot, next.jobId, 'status.json'), JSON.stringify({ phase: 'error', fraction: 1, message: `任务启动失败：${error.message}`, modelKey: next.modelKey, dependencies: next.dependencies }), 'utf8');
          await clearActiveJob(next.jobId);
        }
      }
      await refreshQueuedStatuses();
    } finally {
      scheduling = false;
    }
  }

  async function startJob(projectId, kind, options = {}) {
    const id = safeProjectId(projectId);
    await access(path.join(projectRoot, id, 'project.json'));
    const jobId = randomUUID().replaceAll('-', '');
    const dir = path.join(jobRoot, jobId);
    await mkdir(dir, { recursive: true });
    const payload = { root: repoRoot, project_id: id, ...options };
    try {
      if (kind === 'analyze' || kind === 'storyboard' || kind === 'voice') {
        const settings = await readAiMediaSettings(aiMediaSettingsFile);
        if (settings.director_provider === 'compatible') {
          if (!settings.endpoint || !settings.api_key) throw new Error('兼容全文分析需要先在全局 AI 设置中保存 Endpoint 和 API Key');
          assertEndpointTransport(settings);
        }
        payload.config = {
          provider: kind === 'voice' ? 'ollama' : settings.director_provider,
          base_url: kind === 'voice' ? settings.ollama_endpoint : settings.director_provider === 'compatible' ? settings.endpoint : settings.ollama_endpoint,
          model: settings.director_model,
          instance_id: settings.instance_id,
          text_api: settings.text_api,
          allow_insecure_http: settings.allow_insecure_http,
          timeout_seconds: 600,
          hot_request_timeout_seconds: 120,
          chunk_validation_attempts: 1,
          max_chunk_chars: settings.director_max_chunk_chars,
          pre_split_chunk_chars: 300,
          staged_analysis: true,
          settings_file: aiMediaSettingsFile,
        };
      }
      const dependencies = [activeJob, ...pendingJobs].filter(job => job?.projectId === id).map(job => job.jobId);
      const modelKey = jobModelKey(kind, payload.config);
      const queuedJob = {
        jobId,
        kind,
        projectId: id,
        ...(options.standard_reference?.role_id ? { roleId: safeProjectId(options.standard_reference.role_id) } : {}),
        modelKey,
        dependencies,
        createdAt: new Date().toISOString(),
      };
      await writeFile(path.join(dir, 'input.json'), JSON.stringify(payload), 'utf8');
      await writeFile(path.join(dir, 'status.json'), JSON.stringify({ phase: 'queued', fraction: 0, message: '任务已进入模型队列', modelKey, dependencies, queuePosition: pendingJobs.length + 1 }), 'utf8');
      pendingJobs.push(queuedJob);
      await persistQueue();
      await scheduleQueue();
      return { jobId, kind, modelKey, dependencies, ...(queuedJob.roleId ? { roleId: queuedJob.roleId } : {}) };
    } catch (error) {
      try { await writeFile(path.join(dir, 'status.json'), JSON.stringify({ phase: 'error', fraction: 1, message: `任务入队失败：${error.message}` }), 'utf8'); } catch {}
      throw error;
    }
  }

  async function terminateOwnedRuntime(job, statusFile) {
    if (!['voice', 'render', 'standardize'].includes(job.kind)) return false;
    try {
      const runtimeName = job.kind === 'voice' ? 'voice-design-runtime' : 'render-runtime';
      const runtimeDir = path.join(repoRoot, 'runtime-output', runtimeName);
      const state = JSON.parse(await readFile(path.join(runtimeDir, 'state.json'), 'utf8'));
      const requestId = safeProjectId(state.request_id);
      if (state.phase !== 'busy' || !Number.isSafeInteger(state.pid) || state.pid <= 0) return false;
      const envelope = JSON.parse(await readFile(path.join(runtimeDir, 'requests', `${requestId}.processing`), 'utf8'));
      if (path.resolve(String(envelope.status || '')) !== path.resolve(statusFile)) return false;
      killProcess(state.pid);
      return true;
    } catch {
      return false;
    }
  }

  async function cancelJob(jobId) {
    const id = safeProjectId(jobId);
    const statusFile = path.join(jobRoot, id, 'status.json');
    const queuedIndex = pendingJobs.findIndex(job => job.jobId === id);
    if (queuedIndex >= 0) {
      const [queued] = pendingJobs.splice(queuedIndex, 1);
      await writeFile(statusFile, JSON.stringify({ phase: 'cancelled', fraction: 0, message: '等待中的任务已由用户取消', modelKey: queued.modelKey, dependencies: queued.dependencies }), 'utf8');
      await persistQueue();
      await refreshQueuedStatuses();
      void scheduleQueue();
      return { jobId: id, phase: 'cancelled', message: '等待中的任务已由用户取消', runtimeTerminated: false };
    }
    if (activeJob?.jobId !== id) {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (terminalJobPhases.has(status.phase)) return { jobId: id, phase: status.phase, message: status.message, runtimeTerminated: false };
      const error = new Error('任务当前不在可取消队列中');
      error.statusCode = 409;
      throw error;
    }
    let prior = {};
    try { prior = JSON.parse(await readFile(statusFile, 'utf8')); } catch {}
    cancelledJobIds.add(id);
    await writeFile(statusFile, JSON.stringify({ ...prior, phase: 'cancelling', message: '正在取消任务并停止后台推理' }), 'utf8');
    const runtimeTerminated = await terminateOwnedRuntime(activeJob, statusFile);
    try {
      if (activeChild?.jobId === id && typeof activeChild.child?.kill === 'function') activeChild.child.kill();
      else if (Number.isSafeInteger(activeJob.pid) && activeJob.pid > 0) killProcess(activeJob.pid);
    } catch {}
    await writeFile(statusFile, JSON.stringify({ ...prior, phase: 'cancelled', message: '任务已由用户取消' }), 'utf8');
    await clearActiveJob(id);
    await persistQueue();
    void scheduleQueue();
    return { jobId: id, phase: 'cancelled', message: '任务已由用户取消', runtimeTerminated };
  }

  app.post('/api/projects/:id/analyze', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'analyze')); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/storyboard/regenerate', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const targetShotSeconds = Math.max(3, Math.min(60, Number(request.body?.targetShotSeconds) || 10));
      const projectDir = path.join(projectRoot, id);
      const renderName = await latestRender(projectDir);
      const storyboardCaptions = await renderCaptions(projectDir, renderName);
      return reply.code(202).send(await startJob(id, 'storyboard', { storyboard_only: true, target_shot_seconds: targetShotSeconds, storyboard_captions: storyboardCaptions }));
    }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/render', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'render')); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/assemble', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'render', { cache_only: true })); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/segments/:order/regenerate', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const order = Number(request.params.order);
      if (!Number.isSafeInteger(order) || order < 1) throw new Error('分句序号无效');
      const project = JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8'));
      if (!project.segments?.some(row => Number(row[0]) === order)) throw new Error(`分句 ${order} 不存在`);
      const segment = project.segments.find(row => Number(row[0]) === order);
      const advanced = request.body?.advanced === true || segment?.[17] === 'advanced';
      return reply.code(202).send(await startJob(id, 'render', { fragment_only_orders: [order], ...(advanced ? { advanced_segment_orders: [order] } : {}) }));
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/segments/:order/candidates/:candidateId/select', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const order = Number(request.params.order);
      const candidateId = String(request.params.candidateId || '');
      if (!Number.isSafeInteger(order) || order < 1 || !/^[a-f0-9]{16}$/.test(candidateId)) throw new Error('分句候选标识无效');
      const processDir = path.join(projectRoot, id, 'process');
      const indexPath = path.join(processDir, 'segment-fragments.json');
      const index = JSON.parse(await readFile(indexPath, 'utf8'));
      const entry = Object.entries(index.fragments || {}).find(([, item]) => Number(item.order) === order && (item.candidate_results || []).some(candidate => candidate.candidate_id === candidateId));
      if (!entry) throw new Error(`分句 ${order} 的候选不存在或已经过期`);
      const [cacheKey, fragment] = entry;
      const selectedCandidate = (fragment.candidate_results || []).find(candidate => candidate.candidate_id === candidateId);
      const manualOverride = !Boolean(selectedCandidate?.quality_passed && selectedCandidate?.audio_quality_passed && selectedCandidate?.speaker_verified);
      await copyFile(path.join(processDir, 'segment-candidates', cacheKey, `${candidateId}.wav`), path.join(processDir, 'segment-cache', `${cacheKey}.wav`));
      fragment.selected_candidate_id = candidateId;
      fragment.candidate_results = fragment.candidate_results.map(candidate => ({
        ...candidate,
        selected: candidate.candidate_id === candidateId,
        ...(candidate.candidate_id === candidateId ? {
          manual_override: manualOverride,
          manual_selected_at: new Date().toISOString(),
          manual_selection_method: 'human_listening_accepted',
        } : {}),
      }));
      const temporary = `${indexPath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
      await rename(temporary, indexPath);
      return { selected: true, order, candidateId, manualOverride };
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/roles/:roleId/standard-reference', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
      const role = project.roles.find(row => String(row[0]) === roleId);
      if (!role) throw new Error('角色不存在');
      const asset = project.character_assets?.[roleId];
      if (!asset?.reference_audio?.voice_id) throw new Error('请先上传、应用并保存原始参考音频');
      const pacePreset = ['自然', '舒缓', '自定义'].includes(request.body?.pacePreset) ? request.body.pacePreset : '';
      if (!pacePreset) throw new Error('标准参考样本节奏无效');
      const presetDurationFactor = pacePreset === '自然' ? 1.05 : pacePreset === '舒缓' ? 1.18 : 1;
      const requestedDurationFactor = request.body?.durationFactor ?? presetDurationFactor;
      const durationFactor = Number(requestedDurationFactor);
      if (!Number.isFinite(durationFactor) || durationFactor < 0.5 || durationFactor > 2) throw new Error('声音时长系数必须在 0.50 至 2.00 之间');
      const auditionText = String(request.body?.auditionText || asset.audition_text || '').trim();
      if (auditionText.length < 10 || auditionText.length > 500) throw new Error('标准参考样本试听文本必须在 10 至 500 字符之间');
      return reply.code(202).send(await startJob(id, 'standardize', {
        standard_reference: { role_id: roleId, pace_preset: pacePreset, duration_factor: Math.round(durationFactor * 100) / 100, audition_text: auditionText, language: 'ZH' },
      }));
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });

  async function saveStandardReferenceSelection(id, roleId, requestedVoiceId) {
    const projectLock = projectJobLock(id);
    if (projectLock) {
      const error = new Error(`工程版本已被任务 ${projectLock.jobId} 锁定，请等待任务完成`);
      error.statusCode = 409;
      throw error;
    }
    const projectPath = path.join(projectRoot, id, 'project.json');
    const current = normalizeProject(JSON.parse(await readFile(projectPath, 'utf8')));
    const payload = structuredClone(current);
    const role = payload.roles.find(row => String(row[0]) === roleId);
    if (!role) throw new Error('角色不存在');
    const asset = payload.character_assets?.[roleId];
    const standardized = asset?.standard_reference;
    if (!asset?.reference_audio?.voice_id || !standardized) throw new Error('当前角色没有标准参考样本候选');
    const restoring = requestedVoiceId === asset.reference_audio.voice_id;
    const candidate = restoring ? undefined : standardized.candidates.find(item => item.voice_id === requestedVoiceId);
    if (!restoring && !candidate) throw new Error('标准参考样本候选不存在或已经过期');
    if (candidate && !candidate.quality_passed) throw new Error('该候选未通过全部自动门禁，不能采用');
    const voiceId = restoring ? asset.reference_audio.voice_id : candidate.voice_id;
    const voiceFile = path.join(repoRoot, 'outputs', 'voice-library', `${safeProjectId(voiceId)}.wav`);
    await access(voiceFile);
    role[5] = voiceId;
    role[7] = '否';
    const changedAt = new Date().toISOString();
    standardized.candidates = standardized.candidates.map(item => ({ ...item, selected: item.voice_id === voiceId }));
    if (restoring) {
      standardized.restored_at = changedAt;
    } else {
      standardized.adopted_voice_id = voiceId;
      standardized.adopted_at = changedAt;
      delete standardized.restored_at;
    }
    await reconcileRoleVoiceFiles(payload);
    const changes = directorChangeKinds(directorSnapshot(current), directorSnapshot(payload));
    preserveDirectorOperations(current, payload);
    payload.artifact_invalidation = await invalidateDirectorArtifacts(path.join(projectRoot, id), current, payload, changes);
    payload.updated_at = changedAt;
    const temporary = `${projectPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(temporary, projectPath);
    return projectForClient(payload);
  }

  app.post('/api/projects/:id/roles/:roleId/standard-reference/candidates/:voiceId/adopt', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      const voiceId = safeProjectId(request.params.voiceId);
      return await saveStandardReferenceSelection(id, roleId, voiceId);
    } catch (error) { return reply.code(error.code === 'ENOENT' ? 404 : (error.statusCode || 400)).send({ error: error.code === 'ENOENT' ? '标准参考音频不存在' : error.message }); }
  });

  app.post('/api/projects/:id/roles/:roleId/standard-reference/restore', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      const project = normalizeProject(JSON.parse(await readFile(path.join(projectRoot, id, 'project.json'), 'utf8')));
      const sourceVoiceId = project.character_assets?.[roleId]?.reference_audio?.voice_id;
      if (!sourceVoiceId) throw new Error('当前角色没有可恢复的原始上传样本');
      return await saveStandardReferenceSelection(id, roleId, sourceVoiceId);
    } catch (error) { return reply.code(error.code === 'ENOENT' ? 404 : (error.statusCode || 400)).send({ error: error.code === 'ENOENT' ? '原始参考音频不存在' : error.message }); }
  });
  app.post('/api/projects/:id/voices', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'voice')); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.delete('/api/jobs/:id', async (request, reply) => {
    try { return await cancelJob(request.params.id); }
    catch (error) {
      const statusCode = error.code === 'ENOENT' ? 404 : error.statusCode || 400;
      return reply.code(statusCode).send({ error: error.code === 'ENOENT' ? '任务不存在' : error.message });
    }
  });
  app.get('/api/jobs/:id', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const jobDir = path.join(jobRoot, id);
      const statusFile = path.join(jobDir, 'status.json');
      const [status, statusInfo] = await Promise.all([
        readFile(statusFile, 'utf8').then(JSON.parse),
        stat(statusFile),
      ]);
      let inputInfo = statusInfo;
      try { inputInfo = await stat(path.join(jobDir, 'input.json')); } catch {}
      if (terminalJobPhases.has(status.phase) && activeJob?.jobId === id) await clearActiveJob(id);
      let result;
      try { result = JSON.parse(await readFile(path.join(jobDir, 'result.json'), 'utf8')); } catch {}
      const telemetry = {
        observedAt: new Date().toISOString(),
        startedAt: inputInfo.mtime.toISOString(),
        statusUpdatedAt: statusInfo.mtime.toISOString(),
        workerAlive: false,
      };
      if (activeJob?.jobId === id && Number.isSafeInteger(activeJob.pid) && activeJob.pid > 0) {
        try { process.kill(activeJob.pid, 0); telemetry.workerAlive = true; } catch {}
      }
      if (activeJob?.jobId === id && ['voice', 'render', 'standardize'].includes(activeJob.kind)) {
        try {
          const engine = activeJob.kind === 'voice' ? 'voice' : 'render';
          const runtimeDir = engine === 'voice' ? 'voice-design-runtime' : 'render-runtime';
          const runtimeState = JSON.parse(await readFile(path.join(repoRoot, 'runtime-output', runtimeDir, 'state.json'), 'utf8'));
          const runtimePid = Number(runtimeState.pid);
          let processAlive = false;
          try { process.kill(runtimePid, 0); processAlive = true; } catch {}
          const modelRuntime = {
            engine,
            processAlive,
            pid: runtimePid,
            phase: String(runtimeState.phase || 'unknown'),
            modelLoaded: Boolean(runtimeState.model_loaded),
            startedAt: Number.isFinite(Number(runtimeState.started_at)) ? new Date(Number(runtimeState.started_at) * 1000).toISOString() : undefined,
          };
          if (process.platform !== 'win32' && processAlive) {
            try {
              const io = await readFile(`/proc/${runtimePid}/io`, 'utf8');
              modelRuntime.readBytes = Number(io.match(/^read_bytes:\s*(\d+)/m)?.[1] || 0);
            } catch {}
            try {
              const processStatus = await readFile(`/proc/${runtimePid}/status`, 'utf8');
              modelRuntime.rssBytes = Number(processStatus.match(/^VmRSS:\s*(\d+)\s+kB/m)?.[1] || 0) * 1024;
            } catch {}
          }
          if (engine === 'voice') {
            try {
              const modelRoot = path.join(repoRoot, 'checkpoints', 'Qwen3-TTS-12Hz-1.7B-VoiceDesign');
              const modelFiles = await Promise.all([
                stat(path.join(modelRoot, 'model.safetensors')),
                stat(path.join(modelRoot, 'speech_tokenizer', 'model.safetensors')),
              ]);
              modelRuntime.modelBytes = modelFiles.reduce((total, item) => total + item.size, 0);
            } catch {}
            telemetry.voiceRuntime = modelRuntime;
          } else {
            modelRuntime.modelBytes = Number(runtimeState.model_bytes) || undefined;
          }
          telemetry.modelRuntime = modelRuntime;
        } catch {}
      }
      return { jobId: id, ...status, telemetry, result };
    } catch { return reply.code(404).send({ error: '任务不存在' }); }
  });
  app.get('/api/projects/:id/render-file/:render/:kind', async (request, reply) => {
    const id = safeProjectId(request.params.id);
    const render = safeProjectId(request.params.render);
    const files = { audio: ['full-audio.wav', 'audio/wav'], package: ['directed-audio-package.zip', 'application/zip'], manifest: ['director-manifest.json', 'application/json'] };
    if (request.params.kind === 'mp3') {
      const file = path.join(projectRoot, id, 'renders', render, 'full-audio.wav');
      try {
        await access(file);
        const encoder = launchEncoder(file);
        let stderr = '';
        encoder.stderr?.setEncoding('utf8');
        encoder.stderr?.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
        await new Promise((resolve, reject) => {
          encoder.once('spawn', resolve);
          encoder.once('error', reject);
        });
        encoder.once('close', code => {
          if (code && !reply.raw.destroyed) app.log.error({ code, stderr, file }, 'MP3 实时编码失败');
        });
        reply.raw.once('close', () => {
          if (encoder.exitCode === null && !encoder.killed) encoder.kill();
        });
        const encodedName = encodeURIComponent(`${render}.mp3`);
        reply.type('audio/mpeg').header('Content-Disposition', `attachment; filename="full-audio.mp3"; filename*=UTF-8''${encodedName}`).header('Cache-Control', 'no-store');
        return reply.send(encoder.stdout);
      } catch (error) {
        app.log.error({ error, file }, '无法启动 MP3 实时编码');
        return reply.type('application/json').code(error.code === 'ENOENT' ? 404 : 503).send({ error: error.code === 'ENOENT' ? '交付音频不存在' : `MP3 编码器不可用：${error.message}` });
      }
    }
    const selected = files[request.params.kind];
    if (!selected) return reply.code(404).send({ error: '交付文件类型无效' });
    const file = path.join(projectRoot, id, 'renders', render, selected[0]);
    try {
      await access(file);
      const info = await stat(file);
      reply.type(selected[1]).header('Content-Length', info.size).header('Accept-Ranges', 'bytes');
      return reply.send(createReadStream(file));
    }
    catch { return reply.code(404).send({ error: '交付文件不存在' }); }
  });
  app.get('/api/projects/:id/render-file/:render/segments/:file', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const render = safeProjectId(request.params.render);
      const fileName = safeProjectId(request.params.file);
      const file = path.join(projectRoot, id, 'renders', render, 'segments', fileName);
      const info = await stat(file);
      reply.type('audio/wav').header('Content-Length', info.size).header('Accept-Ranges', 'bytes');
      return reply.send(createReadStream(file));
    } catch { return reply.code(404).send({ error: '分句音频不存在' }); }
  });
  app.get('/api/projects/:id/cached-fragments/:cacheKey', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const cacheKey = String(request.params.cacheKey || '');
      if (!/^[a-f0-9]{64}$/.test(cacheKey)) throw new Error('片断缓存标识无效');
      const file = path.join(projectRoot, id, 'process', 'segment-cache', `${cacheKey}.wav`);
      const info = await stat(file);
      reply.type('audio/wav').header('Content-Length', info.size).header('Accept-Ranges', 'bytes');
      return reply.send(createReadStream(file));
    } catch { return reply.code(404).send({ error: '工程片断缓存不存在' }); }
  });
  app.get('/api/projects/:id/cached-fragment-candidates/:cacheKey/:candidateId', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const cacheKey = String(request.params.cacheKey || '');
      const candidateId = String(request.params.candidateId || '');
      if (!/^[a-f0-9]{64}$/.test(cacheKey) || !/^[a-f0-9]{16}$/.test(candidateId)) throw new Error('分句候选标识无效');
      const file = path.join(projectRoot, id, 'process', 'segment-candidates', cacheKey, `${candidateId}.wav`);
      const info = await stat(file);
      reply.type('audio/wav').header('Content-Length', info.size).header('Accept-Ranges', 'bytes');
      return reply.send(createReadStream(file));
    } catch { return reply.code(404).send({ error: '分句候选音频不存在' }); }
  });
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在' }) : reply.sendFile('index.html'));
  await scheduleQueue();
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildApp();
  await app.listen({ host: process.env.HOST || '0.0.0.0', port: Number(process.env.PORT || 7864) });
}
