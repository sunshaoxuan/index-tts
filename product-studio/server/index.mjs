import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(here, '..', '..');

export const presets = {
  voiceStyles: ['中性清晰', '低沉厚实', '温和亲切', '清亮年轻', '冷静克制', '紧张警觉', '悲伤低落', '威严有力', '沙哑沧桑', '轻快活泼'],
  rhythms: ['自然叙述', '沉稳舒缓', '紧凑清晰', '轻快活泼', '克制停连', '低声内敛', '威严有力'],
  attitudes: ['中性叙述', '沉稳叙述', '温和交流', '紧张警觉', '克制低沉', '悲伤压抑', '喜悦明快', '愤怒强烈', '恐惧迟疑', '威严命令'],
  emotions: ['喜悦', '愤怒', '悲伤', '恐惧', '厌恶', '低落', '惊喜', '平静'],
  paces: ['自然', '舒缓', '紧凑', '轻快', '克制', '低声', '强调'],
  roleKinds: ['narrator', 'character', 'anchor', 'reporter', 'interviewee'],
  languages: ['ZH', 'EN', 'JA', 'ES', 'AR'],
};

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

async function latestRender(projectDir) {
  const rendersDir = path.join(projectDir, 'renders');
  try {
    const entries = await readdir(rendersDir, { withFileTypes: true });
    const candidates = await Promise.all(entries.filter(item => item.isDirectory()).map(async item => ({
      name: item.name, time: (await stat(path.join(rendersDir, item.name))).mtimeMs,
    })));
    return candidates.sort((a, b) => b.time - a.time)[0]?.name;
  } catch { return undefined; }
}

export async function buildApp({ repoRoot = defaultRepoRoot, launchWorker } = {}) {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
  const projectRoot = path.join(repoRoot, 'outputs', 'novel-projects');
  const distRoot = path.join(repoRoot, 'product-studio', 'dist');
  const jobRoot = path.join(repoRoot, 'runtime-output', 'product-jobs');
  let activeJob;
  await mkdir(jobRoot, { recursive: true });
  await app.register(fastifyStatic, { root: distRoot, wildcard: false });

  app.get('/api/health', async () => ({ status: 'ok', runtime: process.version, architecture: 'react-antd-node-python' }));
  app.get('/api/presets', async () => presets);
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
      const payload = { version: 1, project_id: id, title, content_type: contentType, source_text: '', guidance: '', chapters: [], document: {}, roles: [], segments: [], pronunciations: [], voice_files: [], created_at: now, updated_at: now };
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
      const currentPath = path.join(projectRoot, id, 'project.json');
      await access(currentPath);
      const payload = validateProject(request.body, id);
      payload.updated_at = new Date().toISOString();
      const temporary = `${currentPath}.tmp`;
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      await rename(temporary, currentPath);
      return payload;
    } catch (error) { return reply.code(400).send({ error: error.message }); }
  });
  app.get('/api/projects/:id/latest-render', async (request) => {
    const id = safeProjectId(request.params.id);
    const name = await latestRender(path.join(projectRoot, id));
    if (!name) return { available: false };
    const base = `/api/projects/${encodeURIComponent(id)}/render-file/${encodeURIComponent(name)}`;
    return { available: true, audio: `${base}/audio`, package: `${base}/package`, manifest: `${base}/manifest` };
  });
  async function startJob(projectId, kind) {
    if (activeJob) {
      const error = new Error(`任务 ${activeJob.jobId} 正在运行，请等待完成后再启动新任务`);
      error.statusCode = 409;
      throw error;
    }
    const id = safeProjectId(projectId);
    await access(path.join(projectRoot, id, 'project.json'));
    const jobId = randomUUID().replaceAll('-', '');
    const dir = path.join(jobRoot, jobId);
    await mkdir(dir, { recursive: true });
    const input = path.join(dir, 'input.json');
    const status = path.join(dir, 'status.json');
    const result = path.join(dir, 'result.json');
    const worker = kind === 'analysis' ? 'product_analysis_worker.py' : kind === 'voice' ? 'product_voice_worker.py' : 'product_render_worker.py';
    const payload = { root: repoRoot, project_id: id };
    if (kind === 'analysis') payload.config = { base_url: 'http://127.0.0.1:11434', model: 'qwen3:8b', timeout_seconds: 300, max_chunk_chars: 1400 };
    await writeFile(input, JSON.stringify(payload), 'utf8');
    await writeFile(status, JSON.stringify({ phase: 'queued', fraction: 0, message: '任务已进入队列' }), 'utf8');
    const python = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
    const workerArgs = [path.join(repoRoot, worker), '--input', input, '--result', result, '--status', status];
    const child = launchWorker
      ? launchWorker({ python, args: workerArgs, cwd: repoRoot, env: { ...process.env, PYTHONUTF8: '1' } })
      : spawn(python, workerArgs, {
        cwd: repoRoot, detached: false, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' },
      });
    activeJob = { jobId, kind };
    const log = path.join(dir, 'worker.log');
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    child.on('close', async code => {
      const logText = Buffer.concat(chunks).toString('utf8');
      await writeFile(log, logText, 'utf8');
      if (code && code !== 0) {
        let prior = {};
        try { prior = JSON.parse(await readFile(status, 'utf8')); } catch {}
        const workerDetail = logText.trim().split(/\r?\n/).at(-1);
        const detail = String(prior.phase === 'error' && prior.message ? prior.message : workerDetail || `Worker 退出码 ${code}`);
        await writeFile(status, JSON.stringify({ phase: 'error', fraction: 1, message: detail }), 'utf8');
      }
      if (activeJob?.jobId === jobId) activeJob = undefined;
    });
    child.on('error', async error => {
      await writeFile(status, JSON.stringify({ phase: 'error', fraction: 1, message: `Worker 启动失败：${error.message}` }), 'utf8');
      if (activeJob?.jobId === jobId) activeJob = undefined;
    });
    return { jobId, kind };
  }
  app.post('/api/projects/:id/analyze', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'analysis')); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/render', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'render')); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.post('/api/projects/:id/voices', async (request, reply) => {
    try { return reply.code(202).send(await startJob(request.params.id, 'voice')); }
    catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });
  app.get('/api/jobs/:id', async (request, reply) => {
    try {
      const id = safeProjectId(request.params.id);
      const status = JSON.parse(await readFile(path.join(jobRoot, id, 'status.json'), 'utf8'));
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
    try { await access(file); reply.type(selected[1]); return reply.send(createReadStream(file)); }
    catch { return reply.code(404).send({ error: '交付文件不存在' }); }
  });
  app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/') ? reply.code(404).send({ error: '接口不存在' }) : reply.sendFile('index.html'));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildApp();
  await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 7864) });
}
