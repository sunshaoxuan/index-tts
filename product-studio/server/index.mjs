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
    if (roleIds.has(row[0])) throw new Error(`角色轨道重复 ${row[0]}`);
    roleIds.add(row[0]);
    if (!presets.roleKinds.includes(row[2])) throw new Error(`角色 ${row[1]} 的类型无效`);
    if (!String(row[3]).trim()) throw new Error(`角色 ${row[1]} 缺少人物小传`);
    if (!String(row[4]).trim()) throw new Error(`角色 ${row[1]} 缺少音色预设或高级提示`);
    if (!presets.rhythms.includes(row[6])) throw new Error(`角色 ${row[1]} 的节奏预设无效`);
    if (!['是', '否'].includes(row[7])) throw new Error(`角色 ${row[1]} 的重新生成选项无效`);
  });
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
    segments: structuredClone(payload.segments || []),
    pronunciations: structuredClone(payload.pronunciations || []),
  };
}

function directorChangeKinds(before, after) {
  const kinds = [];
  if (before.source_text !== after.source_text) kinds.push('稿件文字');
  if (JSON.stringify(before.roles) !== JSON.stringify(after.roles)) kinds.push('角色与音色');
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

async function invalidateDirectorArtifacts(projectDir, current, next, changes) {
  if (!changes.length) return { invalidatedCacheKeys: [], staleRenders: 0 };
  const invalidateAll = changes.includes('稿件文字') || changes.includes('全篇纠音');
  const nextRoles = new Map((next.roles || []).map(row => [String(row?.[0] || ''), JSON.stringify(row || [])]));
  const changedRoleIds = new Set((current.roles || [])
    .filter(row => nextRoles.get(String(row?.[0] || '')) !== JSON.stringify(row || []))
    .map(row => String(row?.[0] || '')));
  const nextIdentities = new Set((next.segments || []).map(segmentIdentity));
  const invalidatedRows = (current.segments || []).filter(row => invalidateAll
    || changedRoleIds.has(String(row?.[2] || ''))
    || !nextIdentities.has(segmentIdentity(row)));
  const invalidatedSignatures = new Set(invalidatedRows.map(row => `${row[2]}\u0000${row[4]}\u0000${row[5]}\u0000${row[6]}`));
  const invalidatedCacheKeys = new Set();
  const rendersDir = path.join(projectDir, 'renders');
  let staleRenders = 0;
  const renderDirs = [];
  try {
    const renderEntries = await readdir(rendersDir, { withFileTypes: true });
    for (const entry of renderEntries.filter(item => item.isDirectory())) {
      const renderDir = path.join(rendersDir, entry.name);
      renderDirs.push(renderDir);
      try {
        const manifest = JSON.parse(await readFile(path.join(renderDir, 'director-manifest.json'), 'utf8'));
        for (const item of manifest.segments || []) {
          const signature = `${item.speaker_id}\u0000${item.language}\u0000${item.source_text}\u0000${item.text}`;
          if (invalidateAll || invalidatedSignatures.has(signature)) invalidatedCacheKeys.add(String(item.cache_key || ''));
        }
      } catch {}
    }
  } catch {}

  const fragmentIndexPath = path.join(projectDir, 'process', 'segment-fragments.json');
  try {
    const index = JSON.parse(await readFile(fragmentIndexPath, 'utf8'));
    for (const [cacheKey, item] of Object.entries(index.fragments || {})) {
      const signature = `${item.speaker_id}\u0000${item.language}\u0000${item.source_text}\u0000${item.text}`;
      if (invalidateAll || invalidatedSignatures.has(signature)) {
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
  for (const renderDir of renderDirs) {
    const stalePath = path.join(renderDir, '.stale.json');
    let previous = {};
    try { previous = JSON.parse(await readFile(stalePath, 'utf8')); } catch {}
    const stale = {
      stale: true,
      stale_at: staleAt,
      reasons: [...new Set([...(previous.reasons || []), ...changes])],
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

export async function buildApp({ repoRoot = defaultRepoRoot, launchWorker } = {}) {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
  const projectRoot = path.join(repoRoot, 'outputs', 'novel-projects');
  const distRoot = path.join(repoRoot, 'product-studio', 'dist');
  const jobRoot = path.join(repoRoot, 'runtime-output', 'product-jobs');
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

  app.get('/api/health', async () => ({ status: 'ok', runtime: process.version, architecture: 'react-antd-node-python', voiceModel: await voiceRuntimeHealth(repoRoot) }));
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
      const payload = { version: 1, project_id: id, title, content_type: contentType, source_text: '', guidance: '', chapters: [], document: {}, roles: [], segments: [], pronunciations: [], director_history: [], director_memory: { source_text: '', roles: [], segments: [], pronunciations: [] }, voice_files: [], created_at: now, updated_at: now };
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
      const current = JSON.parse(await readFile(currentPath, 'utf8'));
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
    return { available: true, renderId: name, audio: `${base}/audio`, package: `${base}/package`, manifest: `${base}/manifest`, fragments, stale: Boolean(stale?.stale), staleAt: stale?.stale_at, staleReasons: stale?.reasons || [] };
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
