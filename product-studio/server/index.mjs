import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  paces: ['自然', '舒缓', '紧凑', '轻快', '克制', '低声', '强调'],
  roleKinds: ['narrator', 'character', 'anchor', 'reporter', 'interviewee'],
  roleKindLabels: { narrator: '旁白', character: '人物', anchor: '新闻主播', reporter: '记者', interviewee: '采访对象' },
  contentTypeLabels: { novel: '小说', news: '新闻', story: '故事体' },
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
  else if (safeAge < 20) [min, max] = gender === 'male' ? [120, 220] : gender === 'female' ? [175, 285] : [120, 285];
  else if (safeAge < 60) [min, max] = gender === 'male' ? [85, 180] : gender === 'female' ? [165, 255] : [90, 270];
  else [min, max] = gender === 'male' ? [75, 165] : gender === 'female' ? [135, 235] : [80, 250];
  return { min, max, target: Math.round((min + max) / 2) };
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
  return {
    gender, age, pitch_min_hz: min, pitch_max_hz: max, pitch_target_hz: target,
    ...(source.portrait_url ? { portrait_url: String(source.portrait_url) } : {}),
    ...(source.portrait_prompt ? { portrait_prompt: String(source.portrait_prompt) } : {}),
    ...(source.profile_updated_by ? { profile_updated_by: String(source.profile_updated_by) } : {}),
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

function splitChapters(text) {
  const source = String(text || '');
  const pattern = /^[ \t]*(第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇]|Chapter[ \t]+\d+)[ \t]*[^\n]*$/gimu;
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return source ? [{ index: 1, title: '全文', start: 0, end: source.length }] : [];
  const boundaries = matches[0].index > 0 ? [{ start: 0, title: '序章' }] : [];
  boundaries.push(...matches.map(match => ({ start: match.index, title: match[0].trim() })));
  return boundaries.map((item, index) => ({ index: index + 1, title: item.title, start: item.start, end: boundaries[index + 1]?.start ?? source.length }));
}

function closestPreset(value, options, rules, fallback) {
  const text = String(value || '').trim();
  if (options.includes(text)) return text;
  const lower = text.toLowerCase();
  for (const [pattern, preset] of rules) if (pattern.test(lower)) return preset;
  return fallback;
}

function normalizeProject(payload) {
  const copy = structuredClone(payload);
  copy.content_type = ['novel', 'news', 'story'].includes(copy.content_type) ? copy.content_type : 'novel';
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
    updated[7] = closestPreset(updated[7], presets.attitudes, [[/沉稳/, '沉稳叙述'], [/温和|亲切/, '温和交流'], [/紧张|警觉/, '紧张警觉'], [/克制|低沉/, '克制低沉'], [/悲伤|压抑/, '悲伤压抑'], [/喜悦|明快/, '喜悦明快'], [/愤怒|强烈/, '愤怒强烈'], [/恐惧|迟疑/, '恐惧迟疑'], [/威严|命令/, '威严命令']], '中性叙述');
    updated[8] = closestPreset(updated[8], presets.emotions, [[/happy|joy|喜/, '喜悦'], [/angry|anger|愤/, '愤怒'], [/sad|悲/, '悲伤'], [/fear|恐/, '恐惧'], [/disgust|厌/, '厌恶'], [/depress|low|低落/, '低落'], [/surprise|惊/, '惊喜'], [/calm|neutral|自然|平静/, '平静']], '平静');
    updated[10] = closestPreset(updated[10], presets.paces, [[/舒缓|慢/, '舒缓'], [/紧凑|快/, '紧凑'], [/轻快/, '轻快'], [/克制/, '克制'], [/低声/, '低声'], [/强调|重音/, '强调']], '自然');
    return updated;
  }) : [];
  copy.chapters = splitChapters(copy.source_text);
  return copy;
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
  }
  payload.segments.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 12) throw new Error(`分句表第 ${index + 1} 行字段不足`);
    if (!roleIds.has(row[2])) throw new Error(`分句 ${row[0]} 引用了未知角色`);
    if (!presets.languages.includes(row[4])) throw new Error(`分句 ${row[0]} 的语言无效`);
    if (!presets.attitudes.includes(row[7])) throw new Error(`分句 ${row[0]} 的态度预设无效`);
    if (!presets.emotions.includes(row[8])) throw new Error(`分句 ${row[0]} 的情绪预设无效`);
    if (!presets.paces.includes(row[10])) throw new Error(`分句 ${row[0]} 的节奏预设无效`);
  });
  if (!['novel', 'news', 'story'].includes(payload.content_type)) throw new Error('作品体裁无效');
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

function aiRoute(endpoint, route) {
  return `${endpoint}${endpoint.endsWith('/v1') ? '' : '/v1'}${route}`;
}

async function readAiMediaSettings(file) {
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'));
    return {
      endpoint: normalizeAiEndpoint(stored.endpoint),
      api_key: String(stored.api_key || ''),
      text_model: String(stored.text_model || 'gemini-2.5-pro'),
      image_model: String(stored.image_model || 'gpt-image-1'),
    };
  } catch {
    return { endpoint: '', api_key: '', text_model: 'gemini-2.5-pro', image_model: 'gpt-image-1' };
  }
}

function publicAiMediaSettings(settings) {
  return {
    endpoint: settings.endpoint,
    textModel: settings.text_model,
    imageModel: settings.image_model,
    hasApiKey: Boolean(settings.api_key),
  };
}

async function callCompatibleJson(remoteFetch, url, settings, payload) {
  const response = await remoteFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.api_key}` },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = {}; }
  if (!response.ok) throw new Error(String(body?.error?.message || body?.message || `兼容服务请求失败 ${response.status}`));
  return body;
}

async function discoverCompatibleModels(remoteFetch, endpoint, apiKey) {
  const response = await remoteFetch(aiRoute(endpoint, '/models'), {
    headers: { Authorization: `Bearer ${apiKey}` },
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

function extractCompatibleText(body) {
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

function portraitPrompt({ name, profile, gender, age, portraitPrompt }) {
  const genderLabel = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '性别以人物设定为准';
  const custom = String(portraitPrompt || '').trim();
  return [
    `为长篇声音作品中的角色“${name}”创作统一角色设定图。`,
    `人物设定：${profile}`,
    `年龄：约 ${age} 岁。性别：${genderLabel}。`,
    custom ? `补充视觉要求：${custom}` : '',
    '单人半身角色肖像，面部清晰，服装、发型、神态和时代背景与人物小传一致。中性摄影棚背景，电影级自然光，写实而有叙事感。画面中不出现文字、水印、界面、边框或其他人物。保持适合后续插图和视频关键帧复用的稳定角色设计。',
  ].filter(Boolean).join('\n');
}

async function decodeCompatibleImage(remoteFetch, item, settings) {
  if (item?.b64_json) return Buffer.from(String(item.b64_json), 'base64');
  if (item?.inline_data?.data) return Buffer.from(String(item.inline_data.data), 'base64');
  if (item?.inlineData?.data) return Buffer.from(String(item.inlineData.data), 'base64');
  if (item?.url) {
    const response = await remoteFetch(String(item.url), { headers: { Authorization: `Bearer ${settings.api_key}` } });
    if (!response.ok) throw new Error(`兼容服务图像下载失败 ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('兼容服务没有返回图像数据');
}

function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  throw new Error('兼容服务返回了无法识别的图像格式');
}

function launchMp3Encoder(file) {
  return spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', file, '-vn',
    '-codec:a', 'libmp3lame', '-b:a', '160k', '-f', 'mp3', 'pipe:1',
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function buildApp({ repoRoot = defaultRepoRoot, launchWorker, launchEncoder = launchMp3Encoder, remoteFetch = fetch } = {}) {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
  const projectRoot = path.join(repoRoot, 'outputs', 'novel-projects');
  const distRoot = path.join(repoRoot, 'product-studio', 'dist');
  const jobRoot = path.join(repoRoot, 'runtime-output', 'product-jobs');
  const productVersion = (await readFile(path.join(repoRoot, 'VERSION'), 'utf8')).trim();
  const aiMediaSettingsFile = path.join(repoRoot, 'runtime-output', 'product-settings.json');
  const activeJobFile = path.join(jobRoot, 'active-job.json');
  let activeJob;
  await mkdir(jobRoot, { recursive: true });
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
    if (['complete', 'error'].includes(status.phase)) await unlink(activeJobFile);
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
  await app.register(fastifyStatic, { root: distRoot, wildcard: false });

  app.get('/api/health', async () => ({ status: 'ok', productVersion, runtime: process.version, architecture: 'react-antd-node-python', voiceModel: await voiceRuntimeHealth(repoRoot) }));
  app.get('/api/active-job', async () => {
    if (!activeJob) return { available: false };
    try {
      const status = JSON.parse(await readFile(path.join(jobRoot, activeJob.jobId, 'status.json'), 'utf8'));
      if (['complete', 'error'].includes(status.phase)) {
        await clearActiveJob(activeJob.jobId);
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
    try {
      const current = await readAiMediaSettings(aiMediaSettingsFile);
      const endpoint = normalizeAiEndpoint(request.body?.endpoint || current.endpoint);
      const apiKey = String(request.body?.apiKey || current.api_key || '').trim();
      if (!endpoint) throw new Error('请先填写 OpenAI 兼容 Endpoint');
      if (!apiKey) throw new Error('请先填写或保存 API Key');
      const models = await discoverCompatibleModels(remoteFetch, endpoint, apiKey);
      return { ok: true, endpoint, models, modelCount: models.length };
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.put('/api/settings/ai-media', async (request, reply) => {
    try {
      const current = await readAiMediaSettings(aiMediaSettingsFile);
      const endpoint = normalizeAiEndpoint(request.body?.endpoint);
      const textModel = String(request.body?.textModel || '').trim();
      const imageModel = String(request.body?.imageModel || '').trim();
      const apiKey = request.body?.clearApiKey ? '' : String(request.body?.apiKey || current.api_key || '').trim();
      if (endpoint && !textModel) throw new Error('请填写人物小传模型名称');
      if (endpoint && !imageModel) throw new Error('请填写图像模型名称');
      const stored = { endpoint, api_key: apiKey, text_model: textModel || 'gemini-2.5-pro', image_model: imageModel || 'gpt-image-1' };
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
        projects.push({ label: `${payload.title || entry.name}  ${entry.name}`, value: entry.name, updated: payload.updated_at || '' });
      } catch {}
    }
    return projects.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  });
  app.post('/api/projects', async (request, reply) => {
    try {
      const title = String(request.body?.title || '').trim();
      const contentType = String(request.body?.content_type || 'novel');
      if (!title) throw new Error('请填写工程名称');
      if (!['novel', 'news', 'story'].includes(contentType)) throw new Error('作品体裁无效');
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const id = safeProjectId(`${stamp}-${safeSlug(title)}-${randomUUID().slice(0, 6)}`);
      const dir = path.join(projectRoot, id);
      await Promise.all(['voices', 'process', 'renders', 'analysis'].map(name => mkdir(path.join(dir, name), { recursive: true })));
      const now = new Date().toISOString();
      const payload = { version: 1, project_id: id, title, content_type: contentType, source_text: '', guidance: '', chapters: [], document: {}, roles: [], character_assets: {}, segments: [], pronunciations: [], director_history: [], director_memory: { source_text: '', roles: [], character_assets: {}, segments: [], pronunciations: [] }, voice_files: [], created_at: now, updated_at: now };
      await writeFile(path.join(dir, 'project.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      return reply.code(201).send(payload);
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });
  app.get('/api/projects/:id', async (request, reply) => {
    try { return normalizeProject(JSON.parse(await readFile(path.join(projectRoot, safeProjectId(request.params.id), 'project.json'), 'utf8'))); }
    catch (error) { return reply.code(404).send({ error: error.message || '工程不存在' }); }
  });
  app.put('/api/projects/:id', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      if (activeJob?.projectId === id) {
        const error = new Error(`工程版本已被任务 ${activeJob.jobId} 锁定，请等待任务完成`);
        error.statusCode = 409;
        throw error;
      }
      const currentPath = path.join(projectRoot, id, 'project.json');
      await access(currentPath);
      const current = normalizeProject(JSON.parse(await readFile(currentPath, 'utf8')));
      const payload = validateProject(request.body, id);
      const directorChanges = directorChangeKinds(directorSnapshot(current), directorSnapshot(payload));
      preserveDirectorOperations(current, payload);
      payload.artifact_invalidation = await invalidateDirectorArtifacts(path.join(projectRoot, id), current, payload, directorChanges);
      payload.updated_at = new Date().toISOString();
      const temporary = `${currentPath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await rename(temporary, currentPath);
      return payload;
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/roles/:roleId/expand-profile', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      if (activeJob?.projectId === id) return reply.code(409).send({ error: `工程版本已被任务 ${activeJob.jobId} 锁定，请等待任务完成` });
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
      const response = await callCompatibleJson(remoteFetch, aiRoute(settings.endpoint, '/chat/completions'), settings, {
        model: settings.text_model,
        temperature: 0.35,
        messages: [
          { role: 'system', content: '你是长篇声音作品的人物设定导演。只使用稿件证据与用户已确认设定，写一篇具体、可复用、适合声音设计和视觉形象生成的人物小传。未知信息明确写“稿件未说明”，不得虚构关键事实。输出纯中文正文，不使用标题、列表或 Markdown。' },
          { role: 'user', content: `角色：${name}\n年龄设定：约 ${age} 岁\n性别设定：${gender}\n当前小传：${currentProfile}\n稿件相关证据：\n${evidence}\n\n请在 300 至 600 个中文字符内覆盖身份与社会位置、外貌线索、年龄气质、人物关系、经历、欲望与矛盾、性格与行为习惯、说话方式、叙事作用，并区分稿件事实与未知信息。` },
        ],
      });
      const profile = extractCompatibleText(response);
      if (profile.length < 80) throw new Error('兼容服务返回的人物小传过短，请检查模型配置');
      return { profile, model: settings.text_model };
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/roles/:roleId/portrait', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const roleId = safeProjectId(request.params.roleId);
      if (activeJob?.projectId === id) return reply.code(409).send({ error: `工程版本已被任务 ${activeJob.jobId} 锁定，请等待任务完成` });
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
        portraitPrompt: String(request.body?.portraitPrompt || '').trim(),
      };
      if (draft.profile.length < 20) throw new Error('人物小传至少填写 20 个字符后才能生成形象');
      const prompt = portraitPrompt(draft);
      const response = await callCompatibleJson(remoteFetch, aiRoute(settings.endpoint, '/images/generations'), settings, {
        model: settings.image_model, prompt, size: '1024x1024', n: 1, response_format: 'b64_json',
      });
      const item = response?.data?.[0] || response?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData || part?.inline_data);
      const bytes = await decodeCompatibleImage(remoteFetch, item, settings);
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('兼容服务返回的图像为空或超过 20 MB');
      const extension = imageExtension(bytes);
      const assetsDir = path.join(projectRoot, id, 'role-assets');
      await mkdir(assetsDir, { recursive: true });
      const filename = `${safeSlug(roleId)}-${Date.now()}${extension}`;
      await writeFile(path.join(assetsDir, filename), bytes);
      return { portraitUrl: `/api/projects/${encodeURIComponent(id)}/role-assets/${encodeURIComponent(filename)}`, portraitPrompt: prompt, model: settings.image_model };
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
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
  app.get('/api/projects/:id/latest-render', async (request) => {
    const id = safeProjectId(request.params.id);
    const name = await latestRender(path.join(projectRoot, id));
    if (!name) return { available: false };
    const base = `/api/projects/${encodeURIComponent(id)}/render-file/${encodeURIComponent(name)}`;
    let fragments = [];
    let stale;
    try { stale = JSON.parse(await readFile(path.join(projectRoot, id, 'renders', name, '.stale.json'), 'utf8')); } catch {}
    try {
      const manifest = JSON.parse(await readFile(path.join(projectRoot, id, 'renders', name, 'director-manifest.json'), 'utf8'));
      const invalidated = new Set(stale?.invalidated_cache_keys || []);
      fragments = (manifest.segments || []).filter(item => !invalidated.has(item.cache_key)).map(item => ({
        order: Number(item.order), speakerName: String(item.speaker_name || ''), sourceText: String(item.source_text || ''),
        synthesisText: String(item.text || ''), effectiveText: String(item.effective_text || item.text || ''),
        appliedPronunciations: item.applied_pronunciations || [], cacheReused: Boolean(item.cache_reused),
        forcedRegeneration: Boolean(item.forced_regeneration), audio: `${base}/segments/${encodeURIComponent(path.basename(item.audio || ''))}`,
      }));
    } catch {}
    try {
      const draft = JSON.parse(await readFile(path.join(projectRoot, id, 'process', 'segment-fragments.json'), 'utf8'));
      const draftFragments = Object.entries(draft.fragments || {}).map(([cacheKey, item]) => ({
        order: Number(item.order), speakerName: String(item.speaker_name || ''), sourceText: String(item.source_text || ''),
        synthesisText: String(item.text || ''), effectiveText: String(item.effective_text || item.text || ''),
        appliedPronunciations: item.applied_pronunciations || [], cacheReused: false, forcedRegeneration: true,
        audio: `/api/projects/${encodeURIComponent(id)}/cached-fragments/${cacheKey}`,
      }));
      const draftKeys = new Set(draftFragments.map(item => `${item.sourceText}\u0000${item.synthesisText}`));
      fragments = [...fragments.filter(item => !draftKeys.has(`${item.sourceText}\u0000${item.synthesisText}`)), ...draftFragments];
    } catch {}
    return { available: true, renderId: name, audio: `${base}/audio`, mp3: `${base}/mp3`, package: `${base}/package`, manifest: `${base}/manifest`, fragments, stale: Boolean(stale?.stale), staleAt: stale?.stale_at, staleReasons: stale?.reasons || [] };
  });
  app.delete('/api/projects/:id/renders/:renderId', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const renderId = safeProjectId(request.params.renderId);
      if (activeJob?.projectId === id) {
        const error = new Error(`工程版本已被任务 ${activeJob.jobId} 锁定，请等待任务完成`);
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
  async function startJob(projectId, kind, options = {}) {
    if (activeJob) {
      const error = new Error(`任务 ${activeJob.jobId} 正在运行，请等待完成后再启动新任务`);
      error.statusCode = 409;
      throw error;
    }
    const id = safeProjectId(projectId);
    await access(path.join(projectRoot, id, 'project.json'));
    const jobId = randomUUID().replaceAll('-', '');
    activeJob = { jobId, kind, projectId: id };
    try {
      const dir = path.join(jobRoot, jobId);
      await mkdir(dir, { recursive: true });
      const input = path.join(dir, 'input.json');
      const status = path.join(dir, 'status.json');
      const result = path.join(dir, 'result.json');
      const worker = kind === 'analyze' ? 'product_analysis_worker.py' : kind === 'voice' ? 'product_voice_worker.py' : 'product_render_worker.py';
      const payload = { root: repoRoot, project_id: id, ...options };
      if (kind === 'analyze') payload.config = { base_url: 'http://127.0.0.1:11434', model: 'qwen3:8b', timeout_seconds: 300, max_chunk_chars: 1400 };
      await writeFile(input, JSON.stringify(payload), 'utf8');
      await writeFile(status, JSON.stringify({ phase: 'queued', fraction: 0, message: '任务已进入队列' }), 'utf8');
      await writeFile(activeJobFile, JSON.stringify(activeJob), 'utf8');
      const python = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
      const workerArgs = [path.join(repoRoot, worker), '--input', input, '--result', result, '--status', status];
      const child = launchWorker
        ? launchWorker({ python, args: workerArgs, cwd: repoRoot, env: { ...process.env, PYTHONUTF8: '1' } })
        : spawn(python, workerArgs, {
          cwd: repoRoot, detached: false, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' },
        });
      activeJob.pid = Number.isSafeInteger(child.pid) ? child.pid : undefined;
      await writeFile(activeJobFile, JSON.stringify(activeJob), 'utf8');
      const log = path.join(dir, 'worker.log');
      const chunks = [];
      child.stdout.on('data', chunk => chunks.push(chunk));
      child.stderr.on('data', chunk => chunks.push(chunk));
      child.on('close', async code => {
        try {
          const logText = Buffer.concat(chunks).toString('utf8');
          await writeFile(log, logText, 'utf8');
          if (code && code !== 0) {
            let prior = {};
            try { prior = JSON.parse(await readFile(status, 'utf8')); } catch {}
            const workerDetail = logText.trim().split(/\r?\n/).at(-1);
            const detail = String(prior.phase === 'error' && prior.message ? prior.message : workerDetail || `Worker 退出码 ${code}`);
            await writeFile(status, JSON.stringify({ phase: 'error', fraction: 1, message: detail }), 'utf8');
          }
        } finally {
          await clearActiveJob(jobId);
        }
      });
      child.on('error', async error => {
        try {
          await writeFile(status, JSON.stringify({ phase: 'error', fraction: 1, message: `Worker 启动失败：${error.message}` }), 'utf8');
        } finally {
          await clearActiveJob(jobId);
        }
      });
      return { jobId, kind };
    } catch (error) {
      try { await writeFile(path.join(jobRoot, jobId, 'status.json'), JSON.stringify({ phase: 'error', fraction: 1, message: `任务启动失败：${error.message}` }), 'utf8'); } catch {}
      await clearActiveJob(jobId);
      throw error;
    }
  }
  app.post('/api/projects/:id/analyze', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'analyze')); }
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
      return reply.code(202).send(await startJob(id, 'render', { fragment_only_orders: [order] }));
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/voices', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'voice')); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.get('/api/jobs/:id', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const status = JSON.parse(await readFile(path.join(jobRoot, id, 'status.json'), 'utf8'));
      if (['complete', 'error'].includes(status.phase) && activeJob?.jobId === id) await clearActiveJob(id);
      let result;
      try { result = JSON.parse(await readFile(path.join(jobRoot, id, 'result.json'), 'utf8')); } catch {}
      return { jobId: id, ...status, result };
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
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在' }) : reply.sendFile('index.html'));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildApp();
  await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 7864) });
}
