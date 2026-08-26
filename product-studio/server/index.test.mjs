import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { buildApp } from './index.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'index-voice-product-'));
  const dir = path.join(root, 'outputs', 'novel-projects', 'demo');
  await mkdir(path.join(root, 'product-studio', 'dist'), { recursive: true });
  await mkdir(path.join(root, 'examples'), { recursive: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, 'product-studio', 'dist', 'index.html'), '<div>ok</div>');
  await writeFile(path.join(root, 'examples', 'voice_05.wav'), Buffer.from('RIFFfake'));
  const project = { project_id: 'demo', title: '测试', content_type: 'novel', source_text: '第一章\n原文', roles: [['narrator', '旁白', 'narrator', '全篇叙事视角，负责环境、动作、心理活动与说话归属，声音需要保持稳定。', '中性清晰', 'voice.wav', '自然叙述', '否']], segments: [[1, '正文', 'narrator', '旁白', 'ZH', '原文', '原文', '中性叙述', '平静', 0.5, '自然', 300]], pronunciations: [] };
  await writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
  return { root, project };
}

test('serves presets and project data', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const health = await app.inject('/api/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json().voiceModel, { processAlive: false, modelLoaded: false, phase: 'cold' });
  const presetResponse = await app.inject('/api/presets');
  assert.ok(presetResponse.json().emotions.includes('平静'));
  assert.equal(presetResponse.json().voiceStylePrompts['低沉厚实'], '低沉厚实，声音有支撑，气息稳定');
  assert.equal(presetResponse.json().rhythmPrompts['沉稳舒缓'], '沉稳舒缓，重音清晰，短语间自然停连');
  assert.equal((await app.inject('/api/projects/demo')).json().title, '测试');
  await app.close();
});

test('serves the latest audio with stable media headers', async () => {
  const { root } = await fixture();
  const renderDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'renders', 'render-001');
  await mkdir(renderDir, { recursive: true });
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('RIFFfake'));
  await mkdir(path.join(renderDir, 'segments'));
  await writeFile(path.join(renderDir, 'segments', '0001-narrator.wav'), Buffer.from('RIFFsegment'));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [{ order: 1, speaker_name: '旁白', source_text: '原文', text: '原文', effective_text: '纠音原文', applied_pronunciations: ['原文'], audio: 'segments/0001-narrator.wav' }] }));
  const cacheKey = 'a'.repeat(64);
  const processDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'process');
  await mkdir(path.join(processDir, 'segment-cache'), { recursive: true });
  await writeFile(path.join(processDir, 'segment-cache', `${cacheKey}.wav`), Buffer.from('RIFFdraft'));
  await writeFile(path.join(processDir, 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: { [cacheKey]: { order: 2, speaker_name: '旁白', source_text: '新增', text: '新增', effective_text: '新 增', applied_pronunciations: ['新增'] } } }));
  const app = await buildApp({ repoRoot: root });
  const latest = await app.inject('/api/projects/demo/latest-render');
  assert.equal(latest.statusCode, 200);
  assert.equal(latest.json().available, true);
  assert.equal(latest.json().renderId, 'render-001');
  assert.equal(latest.json().fragments.length, 2);
  assert.equal(latest.json().fragments[0].effectiveText, '纠音原文');
  const audio = await app.inject(latest.json().audio);
  assert.equal(audio.statusCode, 200);
  assert.match(audio.headers['content-type'], /^audio\/wav/);
  assert.equal(audio.headers['content-length'], '8');
  assert.equal(audio.headers['accept-ranges'], 'bytes');
  assert.deepEqual(audio.rawPayload, Buffer.from('RIFFfake'));
  const fragment = await app.inject(latest.json().fragments[0].audio);
  assert.equal(fragment.statusCode, 200);
  assert.deepEqual(fragment.rawPayload, Buffer.from('RIFFsegment'));
  const draftFragment = await app.inject(latest.json().fragments.find(item => item.order === 2).audio);
  assert.equal(draftFragment.statusCode, 200);
  assert.deepEqual(draftFragment.rawPayload, Buffer.from('RIFFdraft'));
  await app.close();
});

test('deletes one confirmed render and keeps the project available for later renders', async () => {
  const { root } = await fixture();
  const rendersDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'renders');
  const older = path.join(rendersDir, 'render-001');
  const latest = path.join(rendersDir, 'render-002');
  await mkdir(older, { recursive: true });
  await writeFile(path.join(older, 'full-audio.wav'), Buffer.from('older'));
  await writeFile(path.join(older, 'director-manifest.json'), JSON.stringify({ segments: [] }));
  await new Promise(resolve => setTimeout(resolve, 10));
  await mkdir(latest, { recursive: true });
  await writeFile(path.join(latest, 'full-audio.wav'), Buffer.from('latest'));
  await writeFile(path.join(latest, 'director-manifest.json'), JSON.stringify({ segments: [] }));
  const app = await buildApp({ repoRoot: root });

  assert.equal((await app.inject('/api/projects/demo/latest-render')).json().renderId, 'render-002');
  const deleted = await app.inject({ method: 'DELETE', url: '/api/projects/demo/renders/render-002', payload: {} });
  assert.deepEqual(deleted.json(), { deleted: true, renderId: 'render-002' });
  await assert.rejects(access(latest));
  assert.equal((await app.inject('/api/projects/demo/latest-render')).json().renderId, 'render-001');
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/projects/demo/renders/missing' })).statusCode, 404);
  await app.close();
});

test('rejects render deletion while the same project has an active job', async () => {
  const { root } = await fixture();
  const renderDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'renders', 'render-locked');
  await mkdir(renderDir, { recursive: true });
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('locked'));
  let child;
  const app = await buildApp({ repoRoot: root, launchWorker: () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child;
  } });

  assert.equal((await app.inject({ method: 'POST', url: '/api/projects/demo/analyze', payload: {} })).statusCode, 202);
  const rejected = await app.inject({ method: 'DELETE', url: '/api/projects/demo/renders/render-locked', payload: {} });
  assert.equal(rejected.statusCode, 409);
  assert.match(rejected.json().error, /工程版本已被任务.*锁定/);
  await access(renderDir);
  child.emit('close', 0);
  await app.close();
});

test('serves a role voice preview with seekable range responses', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const full = await app.inject('/api/voices/voice_05.wav/audio');
  assert.equal(full.statusCode, 200);
  assert.match(full.headers['content-type'], /^audio\/wav/);
  assert.equal(full.headers['content-length'], '8');
  assert.equal(full.headers['accept-ranges'], 'bytes');
  const partial = await app.inject({ method: 'GET', url: '/api/voices/voice_05.wav/audio', headers: { range: 'bytes=4-7' } });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers['content-range'], 'bytes 4-7/8');
  assert.equal(partial.headers['content-length'], '4');
  assert.deepEqual(partial.rawPayload, Buffer.from('fake'));
  const missing = await app.inject('/api/voices/missing.wav/audio');
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test('rejects unknown finite presets', async () => {
  const { root, project } = await fixture();
  const app = await buildApp({ repoRoot: root });
  project.segments[0][8] = '随便发挥';
  const response = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /情绪预设无效/);
  await app.close();
});

test('creates a versioned project and saves chapter and pronunciation data', async () => {
  const { root, project } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: '新闻播报', content_type: 'news' } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().content_type, 'news');
  project.pronunciations = [{ source: '重庆银行', replacement: '重 庆 银行', note: '固定读法', enabled: true }];
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().chapters[0].title, '第一章');
  assert.equal(saved.json().pronunciations[0].replacement, '重 庆 银行');
  assert.equal(saved.json().director_history.length, 1);
  assert.deepEqual(saved.json().director_history[0].changes, ['全篇纠音']);
  assert.equal(saved.json().director_memory.pronunciations[0].replacement, '重 庆 银行');
  await app.close();
});

test('invalidates changed segment audio and marks complete renders stale without deleting them', async () => {
  const { root, project } = await fixture();
  const cacheKey = 'b'.repeat(64);
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const renderDir = path.join(projectDir, 'renders', 'render-stale');
  const cacheDir = path.join(projectDir, 'process', 'segment-cache');
  await mkdir(path.join(renderDir, 'segments'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('full'));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [{ order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文', cache_key: cacheKey, audio: 'segments/0001.wav' }] }));
  await writeFile(path.join(cacheDir, `${cacheKey}.wav`), Buffer.from('segment'));
  await writeFile(path.join(projectDir, 'process', 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: { [cacheKey]: { order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文', audio_file: `${cacheKey}.wav` } } }));
  const app = await buildApp({ repoRoot: root });

  project.segments[0][6] = '编辑后的朗读文字';
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().artifact_invalidation, { invalidatedCacheKeys: [cacheKey], staleRenders: 1 });
  await assert.rejects(access(path.join(cacheDir, `${cacheKey}.wav`)));
  await access(path.join(renderDir, 'full-audio.wav'));
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.stale, true);
  assert.deepEqual(latest.staleReasons, ['合成文字与导演参数']);
  assert.deepEqual(latest.fragments, []);

  project.segments[0][6] = '原文';
  const restored = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(restored.statusCode, 200);
  const latestAfterRestore = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latestAfterRestore.stale, true);
  assert.deepEqual(latestAfterRestore.fragments, []);
  const staleRecord = JSON.parse(await readFile(path.join(renderDir, '.stale.json'), 'utf8'));
  assert.deepEqual(staleRecord.invalidated_cache_keys, [cacheKey]);
  await app.close();
});

test('invalidates fragments for a changed role and preserves latest render ordering', async () => {
  const { root, project } = await fixture();
  const olderKey = 'c'.repeat(64);
  const latestKey = 'd'.repeat(64);
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const cacheDir = path.join(projectDir, 'process', 'segment-cache');
  const olderDir = path.join(projectDir, 'renders', 'render-older');
  const latestDir = path.join(projectDir, 'renders', 'render-latest');
  await mkdir(path.join(olderDir, 'segments'), { recursive: true });
  await mkdir(path.join(latestDir, 'segments'), { recursive: true });
  await mkdir(path.join(projectDir, 'renders', 'render-incomplete'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const manifest = cacheKey => ({ segments: [{ order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文', cache_key: cacheKey, audio: 'segments/0001.wav' }] });
  await writeFile(path.join(olderDir, 'director-manifest.json'), JSON.stringify(manifest(olderKey)));
  await new Promise(resolve => setTimeout(resolve, 20));
  await writeFile(path.join(latestDir, 'director-manifest.json'), JSON.stringify(manifest(latestKey)));
  await writeFile(path.join(latestDir, 'full-audio.wav'), Buffer.from('latest-full'));
  await writeFile(path.join(cacheDir, `${latestKey}.wav`), Buffer.from('segment'));
  await writeFile(path.join(projectDir, 'process', 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: { [latestKey]: { order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文' } } }));
  const app = await buildApp({ repoRoot: root });

  project.roles[0][4] = '低沉男声';
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(new Set(saved.json().artifact_invalidation.invalidatedCacheKeys), new Set([olderKey, latestKey]));
  await assert.rejects(access(path.join(cacheDir, `${latestKey}.wav`)));
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.renderId, 'render-latest');
  assert.equal(latest.stale, true);
  assert.deepEqual(latest.fragments, []);
  await access(path.join(latestDir, 'full-audio.wav'));
  await app.close();
});

test('starts strict assembly and one forced segment regeneration with worker options', async () => {
  const { root } = await fixture();
  const launches = [];
  let child;
  const app = await buildApp({ repoRoot: root, launchWorker: details => {
    launches.push(details);
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); return child;
  } });

  const assembled = await app.inject({ method: 'POST', url: '/api/projects/demo/assemble', payload: {} });
  assert.equal(assembled.statusCode, 202);
  let input = JSON.parse(await readFile(launches[0].args[2], 'utf8'));
  assert.equal(input.cache_only, true);
  child.emit('close', 0);
  await new Promise(resolve => setTimeout(resolve, 20));

  const regenerated = await app.inject({ method: 'POST', url: '/api/projects/demo/segments/1/regenerate', payload: {} });
  assert.equal(regenerated.statusCode, 202);
  input = JSON.parse(await readFile(launches[1].args[2], 'utf8'));
  assert.deepEqual(input.fragment_only_orders, [1]);
  child.emit('close', 0);
  await app.close();
});

test('migrates legacy natural language controls to supported presets', async () => {
  const { root, project } = await fixture();
  project.roles[0][6] = '沉稳舒缓，重音清晰，短语间自然停连';
  project.segments[0][7] = '温和亲切地交流';
  project.segments[0][8] = 'neutral';
  project.segments[0][10] = '放慢并增加停连';
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
  const app = await buildApp({ repoRoot: root });
  const migrated = (await app.inject('/api/projects/demo')).json();
  assert.equal(migrated.roles[0][6], '沉稳舒缓');
  assert.equal(migrated.segments[0][7], '温和交流');
  assert.equal(migrated.segments[0][8], '平静');
  assert.equal(migrated.segments[0][10], '舒缓');
  await app.close();
});

test('replaces name-only character metadata with actionable biography and voice defaults', async () => {
  const { root, project } = await fixture();
  project.roles.push(['role_001', '笹垣润三', 'character', '笹垣润三', '笹垣润三', 'voice_04.wav', '自然叙述', '否']);
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
  const app = await buildApp({ repoRoot: root });
  const migrated = (await app.inject('/api/projects/demo')).json();
  assert.match(migrated.roles[1][3], /文本证据尚不足.*人物关系/);
  assert.equal(migrated.roles[1][4], '中性清晰');
  await app.close();
});

test('allows one worker at a time and records a failed worker as error', async () => {
  const { root, project } = await fixture();
  let child;
  const app = await buildApp({ repoRoot: root, launchWorker: () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child;
  } });
  const started = await app.inject({ method: 'POST', url: '/api/projects/demo/analyze', payload: {} });
  assert.equal(started.statusCode, 202);
  const active = await app.inject('/api/active-job');
  assert.deepEqual(active.json(), {
    available: true,
    jobId: started.json().jobId,
    kind: 'analyze',
    projectId: 'demo',
    phase: 'queued',
    fraction: 0,
    message: '任务已进入队列',
  });
  const lockedSave = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(lockedSave.statusCode, 409);
  assert.match(lockedSave.json().error, /工程版本已被任务.*锁定/);
  const rejected = await app.inject({ method: 'POST', url: '/api/projects/demo/render', payload: {} });
  assert.equal(rejected.statusCode, 409);
  child.stderr.write('fixture worker failed');
  child.stderr.end();
  child.stdout.end();
  child.emit('close', 17);
  await new Promise(resolve => setTimeout(resolve, 30));
  const status = await app.inject(`/api/jobs/${started.json().jobId}`);
  assert.equal(status.json().phase, 'error');
  assert.match(status.json().message, /fixture worker failed/);
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
  const unlockedSave = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(unlockedSave.statusCode, 200);
  const restarted = await app.inject({ method: 'POST', url: '/api/projects/demo/render', payload: {} });
  assert.equal(restarted.statusCode, 202);
  child.emit('close', 0);
  await app.close();
});

test('restores a running worker after the server is rebuilt', async () => {
  const { root, project } = await fixture();
  const jobId = 'restoredjob';
  const jobDir = path.join(root, 'runtime-output', 'product-jobs', jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'voice_design', fraction: 0.25, message: '正在生成角色音色' }));
  await writeFile(path.join(root, 'runtime-output', 'product-jobs', 'active-job.json'), JSON.stringify({ jobId, kind: 'voice', projectId: 'demo', pid: process.pid }));

  const app = await buildApp({ repoRoot: root });
  const active = await app.inject('/api/active-job');
  assert.deepEqual(active.json(), {
    available: true,
    jobId,
    kind: 'voice',
    projectId: 'demo',
    pid: process.pid,
    phase: 'voice_design',
    fraction: 0.25,
    message: '正在生成角色音色',
  });
  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project })).statusCode, 409);

  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '角色音色生成完成' }));
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project })).statusCode, 200);
  await app.close();
});

test('marks a restored job as failed when its worker no longer exists', async () => {
  const { root } = await fixture();
  const jobId = 'orphanedjob';
  const jobDir = path.join(root, 'runtime-output', 'product-jobs', jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'voice_design', fraction: 0.05, message: '正在加载模型' }));
  await writeFile(path.join(root, 'runtime-output', 'product-jobs', 'active-job.json'), JSON.stringify({ jobId, kind: 'voice', projectId: 'demo', pid: 2147483647 }));

  const app = await buildApp({ repoRoot: root });
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
  const status = JSON.parse(await readFile(path.join(jobDir, 'status.json'), 'utf8'));
  assert.equal(status.phase, 'error');
  assert.match(status.message, /未发现原 Worker 进程/);
  await app.close();
});
