import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { buildApp, reconcileFragmentsToProject, wavDurationSeconds, workerPython } from './index.mjs';

test('selects a platform appropriate worker interpreter', () => {
  assert.equal(workerPython('/srv/index-tts', 'linux'), 'python3');
  assert.equal(workerPython('C:\\IndexTTS', 'win32'), path.join('C:\\IndexTTS', '.venv', 'Scripts', 'python.exe'));
});

function pcmWav(durationSeconds, sampleRate = 8000) {
  const dataSize = Math.round(durationSeconds * sampleRate * 2);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'index-voice-product-'));
  const dir = path.join(root, 'outputs', 'novel-projects', 'demo');
  await mkdir(path.join(root, 'product-studio', 'dist'), { recursive: true });
  await mkdir(path.join(root, 'examples'), { recursive: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(root, 'VERSION'), '1.0.0\n');
  await writeFile(path.join(root, 'product-studio', 'dist', 'index.html'), '<div>ok</div>');
  await writeFile(path.join(root, 'examples', 'voice_05.wav'), Buffer.from('RIFFfake'));
  const project = { project_id: 'demo', title: '测试', content_type: 'novel', source_text: '第一章\n原文', roles: [['narrator', '旁白', 'narrator', '全篇叙事视角，负责环境、动作、心理活动与说话归属，声音需要保持稳定。', '中性清晰', 'voice.wav', '自然叙述', '否']], segments: [[1, '正文', 'narrator', '旁白', 'ZH', '原文', '原文', '中性叙述', '平静', 0.5, '自然', 300]], pronunciations: [] };
  await writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
  return { root, project };
}

async function waitForActiveJob(app, jobId, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  let active = { available: false };
  while (Date.now() < deadline) {
    active = (await app.inject('/api/active-job')).json();
    if (active.jobId === jobId) return active;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return active;
}

async function waitForLaunches(launches, count, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (launches.length < count && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(launches.length >= count, `等待 ${count} 个 worker 启动，实际为 ${launches.length}`);
}

test('serves presets and project data', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const health = await app.inject('/api/health');
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().productVersion, '1.0.0');
  assert.deepEqual(health.json().voiceModel, { processAlive: false, modelLoaded: false, phase: 'cold' });
  const presetResponse = await app.inject('/api/presets');
  assert.ok(presetResponse.json().emotions.includes('平静'));
  assert.equal(presetResponse.json().emotionDirections.find(item => item.value === 'sly_smile').defaultWeight, 0.8);
  assert.match(presetResponse.json().emotionDirections.find(item => item.value === 'urgent_question').prompt, /urgent and impatient/);
  assert.equal(presetResponse.json().voiceStylePrompts['低沉厚实'], '低沉厚实，声音有支撑，气息稳定');
  assert.equal(presetResponse.json().rhythmPrompts['沉稳舒缓'], '沉稳舒缓，重音清晰，短语间自然停连');
  const project = (await app.inject('/api/projects/demo')).json();
  assert.equal(project.title, '测试');
  assert.equal(project.segments[0][1], '第 1 章');
  await app.close();
});

test('normalizes legacy sentence-sized sections on read and persists chapter numbers on save', async () => {
  const { root, project } = await fixture();
  project.source_text = '第一句。第二句。';
  project.segments = [
    [1, '第一句完整台词', 'narrator', '旁白', 'ZH', '第一句。', '第一句。', '中性叙述', '平静', 0.5, '自然', 300],
    [2, '第二句完整台词', 'narrator', '旁白', 'ZH', '第二句。', '第二句。', '中性叙述', '平静', 0.5, '自然', 300],
  ];
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
  const app = await buildApp({ repoRoot: root });

  const opened = (await app.inject('/api/projects/demo')).json();
  assert.deepEqual(opened.segments.map(row => row[1]), ['第 1 章', '第 1 章']);

  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: opened });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().segments.map(row => row[1]), ['第 1 章', '第 1 章']);
  const persisted = JSON.parse(await readFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), 'utf8'));
  assert.deepEqual(persisted.segments.map(row => row[1]), ['第 1 章', '第 1 章']);
  await app.close();
});

test('returns delivery captions with real WAV duration and manifest pauses', async () => {
  const { root, project } = await fixture();
  project.segments = [
    [1, '正文', 'narrator', '旁白', 'ZH', '第一句。', '第一句。', '中性叙述', '平静', 0.5, '自然', 500],
    [2, '正文', 'narrator', '笹垣润三', 'ZH', '第二句。', '第二句。', '中性叙述', '平静', 0.5, '自然', 0],
  ];
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
  const renderDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'renders', 'render-captioned');
  const segmentsDir = path.join(renderDir, 'segments');
  await mkdir(segmentsDir, { recursive: true });
  await writeFile(path.join(renderDir, 'full-audio.wav'), pcmWav(3.75));
  await writeFile(path.join(segmentsDir, '0001.wav'), pcmWav(1.25));
  await writeFile(path.join(segmentsDir, '0002.wav'), pcmWav(2));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { order: 1, speaker_name: '旁白', source_text: '第一句。', text: '第一句。', pause_after_ms: 500, cache_key: 'a', audio: 'segments\\0001.wav' },
    { order: 2, speaker_name: '笹垣润三', source_text: '第二句。', text: '第二句。', pause_after_ms: 0, cache_key: 'b', audio: 'segments/0002.wav' },
  ] }));

  assert.equal(await wavDurationSeconds(path.join(segmentsDir, '0001.wav')), 1.25);
  const app = await buildApp({ repoRoot: root });
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.deepEqual(latest.captions, [
    { order: 1, speakerName: '旁白', text: '第一句。', durationSeconds: 1.25, pauseAfterMs: 500 },
    { order: 2, speakerName: '笹垣润三', text: '第二句。', durationSeconds: 2, pauseAfterMs: 0 },
  ]);
  assert.match(latest.fragments[0].audio, /\/segments\/0001\.wav$/);
  assert.ok(!latest.fragments[0].audio.includes('%5C'));
  const fragmentAudio = await app.inject(latest.fragments[0].audio);
  assert.equal(fragmentAudio.statusCode, 200);
  assert.equal(fragmentAudio.headers['content-type'], 'audio/wav');
  assert.equal(Number(fragmentAudio.headers['content-length']), pcmWav(1.25).length);
  await app.close();
});

test('saving a selected role candidate backfills its stable voice asset without changing segment speakers', async () => {
  const { root } = await fixture();
  const voiceDir = path.join(root, 'outputs', 'voice-library');
  await mkdir(voiceDir, { recursive: true });
  const selectedVoice = path.join(voiceDir, 'voice-selected.wav');
  await writeFile(selectedVoice, Buffer.from('RIFFselected'));
  const app = await buildApp({ repoRoot: root });
  const project = (await app.inject('/api/projects/demo')).json();
  project.roles[0][5] = 'voice-selected';
  project.voice_files = [];
  project.character_assets.narrator.voice_candidates = [{ voice_id: 'voice-selected', seed: 44, selected: true, gender_verified: true }];
  const originalSegments = structuredClone(project.segments);

  const response = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().segments, originalSegments);
  assert.equal(response.json().roles[0][5], 'voice-selected');
  assert.deepEqual(response.json().voice_files, [selectedVoice]);
  assert.equal(response.json().character_assets.narrator.voice_candidates[0].selected, true);
  await app.close();
});

test('loading a legacy project atomically persists missing current role voice assets', async () => {
  const { root } = await fixture();
  const voiceDir = path.join(root, 'outputs', 'voice-library');
  await mkdir(voiceDir, { recursive: true });
  const currentVoice = path.join(voiceDir, 'voice-current.wav');
  await writeFile(currentVoice, Buffer.from('RIFFcurrent'));
  const projectPath = path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json');
  const stored = JSON.parse(await readFile(projectPath, 'utf8'));
  stored.roles[0][5] = 'voice-current';
  stored.voice_files = [];
  await writeFile(projectPath, JSON.stringify(stored));
  const app = await buildApp({ repoRoot: root });

  const response = await app.inject('/api/projects/demo');
  const persisted = JSON.parse(await readFile(projectPath, 'utf8'));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().voice_files, [currentVoice]);
  assert.deepEqual(persisted.voice_files, [currentVoice]);
  assert.deepEqual(persisted.segments, stored.segments);
  await app.close();
});

test('deletes one confirmed project directory and preserves the permanent voice library', async () => {
  const { root } = await fixture();
  const voiceDir = path.join(root, 'outputs', 'voice-library');
  await mkdir(voiceDir, { recursive: true });
  const permanentVoice = path.join(voiceDir, 'voice-shared.wav');
  await writeFile(permanentVoice, Buffer.from('RIFFshared'));
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  await mkdir(path.join(projectDir, 'renders', 'render-001'), { recursive: true });
  await writeFile(path.join(projectDir, 'renders', 'render-001', 'full-audio.wav'), Buffer.from('RIFFrender'));
  const app = await buildApp({ repoRoot: root });

  const deleted = await app.inject({ method: 'DELETE', url: '/api/projects/demo' });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json(), { deleted: true, projectId: 'demo' });
  await assert.rejects(access(projectDir));
  await access(permanentVoice);
  assert.deepEqual((await app.inject('/api/projects')).json(), []);
  assert.equal((await app.inject('/api/projects/demo')).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/projects/demo' })).statusCode, 404);
  await app.close();
});

test('stores AI media credentials locally without returning the API key', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const saved = await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'http://127.0.0.1:49530/v1/', apiKey: 'secret-key', textModel: 'gemini-pro', imageModel: 'gpt-image' } });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json(), { endpoint: 'http://127.0.0.1:49530/v1', textModel: 'gemini-pro', directorProvider: 'ollama', directorModel: 'qwen3:14b', ollamaEndpoint: 'http://127.0.0.1:11434', directorMaxChunkChars: 1400, imageModel: 'gpt-image', imageFallbackModel: '', imageFallbackEnabled: false, instanceId: '', textApi: 'chat_completions', allowInsecureHttp: false, transportRisk: false, hasApiKey: true });
  const loaded = await app.inject('/api/settings/ai-media');
  assert.equal(loaded.json().hasApiKey, true);
  assert.equal(JSON.stringify(loaded.json()).includes('secret-key'), false);
  const stored = JSON.parse(await readFile(path.join(root, 'runtime-output', 'product-settings.json'), 'utf8'));
  assert.equal(stored.api_key, 'secret-key');
  await app.close();
});

test('tests the compatible service and returns selectable model ids without exposing the API key', async () => {
  const { root } = await fixture();
  const calls = [];
  const remoteFetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options?.headers?.Authorization, abortable: options?.signal instanceof AbortSignal });
    return new Response(JSON.stringify({ data: [{ id: 'gemini-2.5-flash' }, { id: 'gpt-image-1' }, { id: 'gemini-2.5-flash' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'http://ai.example/v1', apiKey: 'secret-key', textModel: 'old-model', imageModel: 'old-image', allowInsecureHttp: true } });
  const tested = await app.inject({ method: 'POST', url: '/api/settings/ai-media/test', payload: { endpoint: 'http://ai.example/v1' } });
  assert.equal(tested.statusCode, 200);
  assert.deepEqual(tested.json(), { ok: true, endpoint: 'http://ai.example/v1', instanceId: '', models: ['gemini-2.5-flash', 'gpt-image-1'], modelCount: 2 });
  assert.deepEqual(calls, [{ url: 'http://ai.example/v1/models', authorization: 'Bearer secret-key', abortable: true }]);
  assert.equal(JSON.stringify(tested.json()).includes('secret-key'), false);
  await app.close();
});

test('stores and tests the global text director independently from role assets', async () => {
  const { root } = await fixture();
  const calls = [];
  const remoteFetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'qwen3:14b' }] }), { status: 200 });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  const saved = await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { directorProvider: 'ollama', directorModel: 'qwen3:14b', ollamaEndpoint: 'http://127.0.0.1:11434/', directorMaxChunkChars: 2200, endpoint: '', textModel: 'profile-model', imageModel: 'image-model' } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().directorProvider, 'ollama');
  assert.equal(saved.json().directorModel, 'qwen3:14b');
  assert.equal(saved.json().directorMaxChunkChars, 2200);
  const tested = await app.inject({ method: 'POST', url: '/api/settings/ai-media/director-test', payload: { directorProvider: 'ollama', ollamaEndpoint: 'http://127.0.0.1:11434' } });
  assert.equal(tested.statusCode, 200);
  assert.deepEqual(tested.json().models, ['qwen3:14b', 'qwen3:8b']);
  assert.deepEqual(calls, ['http://127.0.0.1:11434/api/tags']);
  await app.close();
});

test('writes global compatible director configuration to the analysis worker without copying the API key', async () => {
  const { root } = await fixture();
  let child;
  let launch;
  const app = await buildApp({ repoRoot: root, launchWorker: details => {
    launch = details;
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); return child;
  } });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'director-secret', instanceId: '.director-agent', directorProvider: 'compatible', directorModel: 'gpt-5.6-terra', directorMaxChunkChars: 2400, textApi: 'responses', textModel: 'gpt-5.6-luna', imageModel: 'gpt-image-2' } });
  const started = await app.inject({ method: 'POST', url: '/api/projects/demo/analyze', payload: {} });
  assert.equal(started.statusCode, 202);
  const input = JSON.parse(await readFile(launch.args[2], 'utf8'));
  assert.equal(input.config.provider, 'compatible');
  assert.equal(input.config.model, 'gpt-5.6-terra');
  assert.equal(input.config.text_api, 'responses');
  assert.equal(input.config.instance_id, '.director-agent');
  assert.equal(input.config.max_chunk_chars, 2400);
  assert.equal(input.config.timeout_seconds, 600);
  assert.equal(input.config.hot_request_timeout_seconds, 120);
  assert.equal(input.config.chunk_validation_attempts, 1);
  assert.equal(input.config.pre_split_chunk_chars, 300);
  assert.equal(input.config.staged_analysis, true);
  assert.equal(JSON.stringify(input).includes('director-secret'), false);
  child.emit('close', 0);
  await app.close();
});

test('stores distinct primary and complement image models with cooldown switching enabled', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const saved = await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: {
    endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model',
    imageModel: 'gpt-image-2', imageFallbackModel: 'gemini-3-pro-image', imageFallbackEnabled: true,
  } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().imageModel, 'gpt-image-2');
  assert.equal(saved.json().imageFallbackModel, 'gemini-3-pro-image');
  assert.equal(saved.json().imageFallbackEnabled, true);
  const stored = JSON.parse(await readFile(path.join(root, 'runtime-output', 'product-settings.json'), 'utf8'));
  assert.equal(stored.image_model, 'gpt-image-2');
  assert.equal(stored.image_fallback_model, 'gemini-3-pro-image');
  assert.equal(stored.image_fallback_enabled, true);
  const missingComplement = await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: {
    endpoint: 'https://ai.example/v1', textModel: 'text-model', imageModel: 'gpt-image-2', imageFallbackEnabled: true,
  } });
  assert.equal(missingComplement.statusCode, 400);
  assert.match(missingComplement.json().error, /填写互补图像模型/);
  const duplicateModels = await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: {
    endpoint: 'https://ai.example/v1', textModel: 'text-model', imageModel: 'gpt-image-2', imageFallbackModel: 'gpt-image-2', imageFallbackEnabled: true,
  } });
  assert.equal(duplicateModels.statusCode, 400);
  assert.match(duplicateModels.json().error, /必须与主图像模型不同/);
  await app.close();
});

test('starts an isolated storyboard regeneration job with the director worker', async () => {
  const { root } = await fixture();
  let child;
  let launch;
  const app = await buildApp({ repoRoot: root, launchWorker: details => {
    launch = details;
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); return child;
  } });

  const started = await app.inject({ method: 'POST', url: '/api/projects/demo/storyboard/regenerate', payload: {} });

  assert.equal(started.statusCode, 202);
  assert.equal(started.json().kind, 'storyboard');
  assert.match(launch.args[0], /product_analysis_worker\.py$/u);
  const input = JSON.parse(await readFile(launch.args[2], 'utf8'));
  assert.equal(input.storyboard_only, true);
  assert.equal(input.target_shot_seconds, 10);
  assert.deepEqual(input.storyboard_captions, []);
  assert.equal(input.config.model, 'qwen3:14b');
  child.emit('close', 0);
  await app.close();
});

test('uses Cockpit instance headers and the Responses API for character profiles', async () => {
  const { root } = await fixture();
  const calls = [];
  const remoteFetch = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers, body: options?.body ? JSON.parse(options.body) : undefined });
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gemini-pro-agent' }, { id: 'claude-opus-4-6-thinking' }] }), { status: 200 });
    return new Response(JSON.stringify({ output_text: '这是一篇通过 Responses API 生成的详细人物小传，覆盖人物身份、年龄气质、关系、经历、欲望、矛盾、性格、行为习惯、说话方式与叙事作用，并明确保留稿件未说明的事实边界。'.repeat(2) }), { status: 200 });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  const saved = await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'http://127.0.0.1:39452/v1', apiKey: 'cockpit-key', instanceId: '.codex-gemini-agent', textApi: 'responses', textModel: 'gemini-pro-agent', imageModel: 'gpt-image-1' } });
  assert.equal(saved.statusCode, 200);
  const models = await app.inject({ method: 'POST', url: '/api/settings/ai-media/test', payload: {} });
  assert.equal(models.statusCode, 200);
  assert.deepEqual(models.json().models, ['claude-opus-4-6-thinking', 'gemini-pro-agent']);
  const profile = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/expand-profile', payload: { name: '旁白', profile: '负责全文叙事的人物设定。', gender: 'unspecified', age: 40 } });
  assert.equal(profile.statusCode, 200);
  assert.deepEqual(calls.map(call => call.url), ['http://127.0.0.1:39452/v1/models', 'http://127.0.0.1:39452/v1/responses']);
  assert.ok(calls.every(call => call.headers.Authorization === 'Bearer cockpit-key'));
  assert.ok(calls.every(call => call.headers['X-Cockpit-Instance-Id'] === '.codex-gemini-agent'));
  assert.equal(calls[1].body.model, 'gemini-pro-agent');
  assert.equal(calls[1].body.stream, false);
  assert.equal(typeof calls[1].body.input, 'string');
  await app.close();
});

test('blocks bearer credentials on public HTTP until the risk is explicitly allowed', async () => {
  const { root } = await fixture();
  let called = false;
  const app = await buildApp({ repoRoot: root, remoteFetch: async () => { called = true; return new Response('{}', { status: 200 }); } });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'http://remote.example/v1', apiKey: 'remote-key', textModel: 'text-model', imageModel: 'image-model' } });
  const tested = await app.inject({ method: 'POST', url: '/api/settings/ai-media/test', payload: {} });
  assert.equal(tested.statusCode, 400);
  assert.match(tested.json().error, /公网 HTTP/);
  assert.equal(called, false);
  await app.close();
});

test('expands a character profile and generates a locally served portrait through compatible APIs', async () => {
  const { root } = await fixture();
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const remoteFetch = async (url, options) => {
    calls.push({ url: String(url), authorization: options?.headers?.Authorization, body: options?.body ? JSON.parse(options.body) : undefined });
    if (String(url).endsWith('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: '这是一篇基于稿件证据扩写的详细人物小传，包含身份、年龄气质、人物关系、经历、欲望与矛盾、性格、行为习惯、说话方式和叙事作用。稿件未说明外貌细节，因此保留未知边界。'.repeat(2) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'http://ai.example/v1', apiKey: 'secret-key', textModel: 'gemini-pro', imageModel: 'gpt-image', allowInsecureHttp: true } });
  const profile = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/expand-profile', payload: { name: '旁白', profile: '负责全文叙事的人物设定。', gender: 'unspecified', age: 40 } });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().model, 'gemini-pro');
  assert.ok(profile.json().profile.length >= 80);
  const portrait = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/portrait', payload: { name: '旁白', profile: profile.json().profile, gender: 'unspecified', age: 40, portraitStyle: 'noir_ink', portraitPrompt: '保留旧式礼帽' } });
  assert.equal(portrait.statusCode, 200);
  assert.equal(portrait.json().model, 'gpt-image');
  const image = await app.inject(portrait.json().portraitUrl);
  assert.equal(image.statusCode, 200);
  assert.match(image.headers['content-type'], /^image\/png/);
  assert.deepEqual(image.rawPayload, png);
  assert.deepEqual(calls.map(call => call.url), ['http://ai.example/v1/chat/completions', 'http://ai.example/v1/images/generations']);
  assert.ok(calls.every(call => call.authorization === 'Bearer secret-key'));
  assert.equal(calls[1].body.model, 'gpt-image');
  assert.match(calls[1].body.prompt, /稳定.*角色设计/);
  assert.match(calls[1].body.prompt, /黑白悬疑墨线漫画/);
  assert.match(calls[1].body.prompt, /保留旧式礼帽/);
  assert.equal(portrait.json().portraitStyle, 'noir_ink');
  await app.close();
});

test('generates a Gemini portrait through Chat Completions and decodes a Markdown data URL', async () => {
  const { root } = await fixture();
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 31, 32, 33, 34]);
  const remoteFetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: `![image](data:image/png;base64,${png.toString('base64')})` } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model', imageModel: 'gemini-3.1-flash-image' } });
  const portrait = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/portrait', payload: { name: '旁白', profile: '负责全文叙事，并具有稳定人物设定和明确的视觉识别特征。', gender: 'unspecified', age: 40 } });
  assert.equal(portrait.statusCode, 200);
  assert.equal(calls[0].url, 'https://ai.example/v1/chat/completions');
  assert.equal(calls[0].body.model, 'gemini-3.1-flash-image');
  assert.deepEqual(calls[0].body.generationConfig.responseModalities, ['IMAGE']);
  assert.equal((await app.inject(portrait.json().portraitUrl)).statusCode, 200);
  await app.close();
});

test('falls back to GPT Image when the Gemini portrait gateway returns HTML 502', async () => {
  const { root } = await fixture();
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 41, 42, 43, 44]);
  const remoteFetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url).endsWith('/chat/completions')) {
      return new Response('<!DOCTYPE html><title>Bad Gateway</title>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model', imageModel: 'gemini-3.1-flash-image', imageFallbackModel: 'gpt-image-2', imageFallbackEnabled: true } });
  const portrait = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/portrait', payload: { name: '旁白', profile: '负责全文叙事，并具有稳定人物设定和明确的视觉识别特征。', gender: 'unspecified', age: 40, allowFallback: true } });
  assert.equal(portrait.statusCode, 200);
  assert.deepEqual(calls.map(call => call.url), ['https://ai.example/v1/chat/completions', 'https://ai.example/v1/images/generations']);
  assert.equal(portrait.json().requestedModel, 'gemini-3.1-flash-image');
  assert.equal(portrait.json().model, 'gpt-image-2');
  assert.equal(portrait.json().modelFallbackUsed, true);
  assert.match(portrait.json().modelFallbackReason, /502/);
  assert.equal((await app.inject(portrait.json().portraitUrl)).statusCode, 200);
  await app.close();
});

test('defaults portraits to comics and uses realistic rendering only when explicitly selected', async () => {
  const { root } = await fixture();
  const prompts = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 10, 11, 12]);
  const remoteFetch = async (_url, options) => {
    prompts.push(JSON.parse(options.body).prompt);
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model', imageModel: 'image-model' } });
  const payload = { name: '旁白', profile: '负责全文叙事，并具有稳定人物设定和明确的视觉识别特征。', gender: 'unspecified', age: 40 };
  const comic = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/portrait', payload });
  const realistic = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/portrait', payload: { ...payload, portraitStyle: 'realistic_photo' } });
  assert.equal(comic.statusCode, 200);
  assert.equal(realistic.statusCode, 200);
  assert.equal(comic.json().portraitStyle, 'cinematic_manga');
  assert.equal(realistic.json().portraitStyle, 'realistic_photo');
  assert.match(prompts[0], /电影感漫画/);
  assert.match(prompts[0], /单人半身漫画角色肖像/);
  assert.doesNotMatch(prompts[0], /真人写实摄影/);
  assert.match(prompts[1], /真人写实摄影/);
  assert.match(prompts[1], /单人半身真人肖像/);
  await app.close();
});

test('generates one storyboard keyframe and a full set from AI scene notes with selectable styles', async () => {
  const { root } = await fixture();
  const projectPath = path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json');
  const stored = JSON.parse(await readFile(projectPath, 'utf8'));
  stored.document = { scenes: [
    { id: 'scene_001', title: '雨夜抵达', topic: '访客抵达', location: '旧宅门廊', spatial_direction: '室外朝向门内', time: '深夜', participants: ['narrator'], narrative_perspective: '第三人称', mood: '悬疑', storyboard_note: '雨幕覆盖旧宅门廊，访客站在画面左侧收起黑伞，门内暖光从右后方切入，前景积水映出人物剪影，中景木门半开，远景保持在暗色庭院。镜头采用中远景并从室外朝向门内。', boundary_reason: '地点从街道切换到旧宅门廊', evidence: '访客在雨夜抵达旧宅', shots: [{ id: 'scene_001_shot_001', title: '收伞', storyboard_note: '访客站在门廊左侧收起黑伞，前景积水映出剪影，镜头低位朝向门内暖光。', source_text: '访客走上门廊，在雨幕中收起黑伞。', source_evidence: '收起黑伞', participants: ['narrator'], start_segment_order: 1, end_segment_order: 1 }] },
    { id: 'scene_002', title: '进入客厅', topic: '室内会面', location: '旧宅客厅', spatial_direction: '室内面向壁炉', time: '深夜', participants: ['narrator'], narrative_perspective: '第三人称', mood: '克制', storyboard_note: '客厅以壁炉为视觉中心，人物停在画面右侧入口处，前景旧木桌压住信封，中景空椅形成等待感，壁炉微光照亮织物和灰尘，背景楼梯隐入阴影。镜头使用平视广角并面向壁炉。', boundary_reason: '人物由门廊进入室内', evidence: '木门关闭后人物进入客厅', shots: [{ id: 'scene_002_shot_001', title: '望向壁炉', storyboard_note: '人物停在客厅右侧入口，前景木桌压着信封，平视广角朝向壁炉和空椅。', source_text: '木门关闭后，他走进客厅望向壁炉。', source_evidence: '望向壁炉', participants: ['narrator'], start_segment_order: 2, end_segment_order: 2 }] },
  ] };
  await writeFile(projectPath, JSON.stringify(stored));
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 21, 22, 23, 24]);
  const remoteFetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model', imageModel: 'image-model' } });
  const project = (await app.inject('/api/projects/demo')).json();

  const single = await app.inject({ method: 'POST', url: '/api/projects/demo/scenes/scene_001/keyframe', payload: { scene: project.document.scenes[0], keyframeStyle: 'noir_ink' } });
  assert.equal(single.statusCode, 200);
  assert.equal(single.json().sceneId, 'scene_001');
  assert.equal(single.json().keyframeStyle, 'noir_ink');
  assert.equal((await app.inject(single.json().keyframeUrl)).statusCode, 200);
  assert.equal(calls[0].body.size, '1536x1024');
  assert.match(calls[0].body.prompt, /AI 镜头画面小记/);
  assert.match(calls[0].body.prompt, /黑白悬疑墨线分镜/);
  assert.match(calls[0].body.prompt, /16:9/);

  const shot = await app.inject({ method: 'POST', url: '/api/projects/demo/scenes/scene_001/shots/scene_001_shot_001/keyframe', payload: { shot: project.document.scenes[0].shots[0], keyframeStyle: 'clean_cel' } });
  assert.equal(shot.statusCode, 200);
  assert.equal(shot.json().shotId, 'scene_001_shot_001');
  assert.match(calls[1].body.prompt, /镜头对应原文：访客走上门廊，在雨幕中收起黑伞/);

  const allShots = project.document.scenes.flatMap(scene => scene.shots);
  const full = await app.inject({ method: 'POST', url: '/api/projects/demo/storyboard/keyframes', payload: { shots: allShots, keyframeStyle: 'cinematic_realistic' } });
  assert.equal(full.statusCode, 200);
  assert.equal(full.json().generatedCount, 2);
  assert.deepEqual(full.json().keyframes.map(item => item.shotId), ['scene_001_shot_001', 'scene_002_shot_001']);
  assert.ok(calls.slice(2).every(call => /电影写实关键帧/.test(call.body.prompt)));
  assert.ok(calls.every(call => call.body.model === 'image-model'));
  assert.equal((await app.inject(full.json().keyframes[1].keyframeUrl)).headers['content-type'], 'image/png');
  await app.close();
});

test('uses stable local and linked role portraits as ordered identity references for single and full storyboard generation', async () => {
  const { root, project } = await fixture();
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const linkedProjectDir = path.join(root, 'outputs', 'novel-projects', 'linked-source');
  const localPortrait = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const linkedPortrait = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5, 6, 7, 8]);
  await mkdir(path.join(projectDir, 'role-assets'), { recursive: true });
  await mkdir(path.join(linkedProjectDir, 'role-assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'role-assets', 'role-a.png'), localPortrait);
  await writeFile(path.join(linkedProjectDir, 'role-assets', 'role-b.png'), linkedPortrait);
  project.roles = [
    project.roles[0],
    ['role_a', '甲', 'character', '甲是主要人物，短发，面部轮廓清晰，年龄与五官设定需要跨镜头保持一致。', '中性清晰', '', '自然叙述', '否'],
    ['role_b', '乙', 'character', '乙是同行人物，长发，眼角有标志性小痣，年龄与五官设定需要跨镜头保持一致。', '中性清晰', '', '自然叙述', '否'],
  ];
  project.character_assets = {
    role_a: { gender: 'female', age: 28, portrait_url: '/api/projects/demo/role-assets/role-a.png' },
    role_b: { gender: 'male', age: 31, portrait_url: '/api/projects/linked-source/role-assets/role-b.png' },
  };
  project.document = { scenes: [{
    id: 'scene_identity', title: '并肩进入', topic: '两人进入房间', location: '会客室', spatial_direction: '门口朝向窗边', time: '傍晚', mood: '克制', narrative_perspective: '第三人称', participants: ['role_b', 'narrator', 'role_a'], storyboard_note: '甲在画面左侧推门，乙在右后方观察窗边，暖光沿两人的面部轮廓落下，前景保留门框，中景呈现人物动作。', shots: [{ id: 'scene_identity_shot_001', title: '推门', participants: ['role_b', 'narrator', 'role_a'], storyboard_note: '甲在画面左侧推门，乙在右后方观察窗边，暖光沿两人的面部轮廓落下，前景保留门框，中景呈现人物动作。', start_segment_order: 1, end_segment_order: 1 }],
  }] };
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));

  const requests = [];
  const generated = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9, 9]);
  const remoteFetch = async (url, options) => {
    const fields = [];
    for (const [name, value] of options.body.entries()) fields.push(typeof value === 'string' ? { name, value } : { name, filename: value.name, type: value.type, bytes: Buffer.from(await value.arrayBuffer()) });
    requests.push({ url: String(url), headers: options.headers, fields });
    return new Response(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model', imageModel: 'gpt-image-2' } });
  const opened = (await app.inject('/api/projects/demo')).json();
  const shot = opened.document.scenes[0].shots[0];

  const single = await app.inject({ method: 'POST', url: '/api/projects/demo/scenes/scene_identity/shots/scene_identity_shot_001/keyframe', payload: { shot, keyframeStyle: 'cinematic_realistic' } });
  assert.equal(single.statusCode, 200);
  assert.equal(single.json().identityReferenceMode, 'role_portraits');
  assert.deepEqual(single.json().referenceCharacters.map(reference => [reference.roleId, reference.name, reference.portraitUrl]), [
    ['role_a', '甲', '/api/projects/demo/role-assets/role-a.png'],
    ['role_b', '乙', '/api/projects/linked-source/role-assets/role-b.png'],
  ]);
  assert.ok(single.json().referenceCharacters.every(reference => /^[a-f0-9]{64}$/.test(reference.portraitSha256)));

  const requestCountBeforePreflight = requests.length;
  const preflight = await app.inject({ method: 'POST', url: '/api/projects/demo/storyboard/keyframes', payload: { shots: [shot], keyframeStyle: 'cinematic_realistic', preflightOnly: true } });
  assert.equal(preflight.statusCode, 200);
  assert.deepEqual(preflight.json(), { validatedCount: 1, shotIds: ['scene_identity_shot_001'], model: 'gpt-image-2', candidateModels: ['gpt-image-2'] });
  assert.equal(requests.length, requestCountBeforePreflight);

  const full = await app.inject({ method: 'POST', url: '/api/projects/demo/storyboard/keyframes', payload: { shots: [shot], keyframeStyle: 'cinematic_realistic' } });
  assert.equal(full.statusCode, 200);
  assert.equal(full.json().keyframes[0].referenceCharacters.length, 2);
  assert.ok(requests.every(request => request.url === 'https://ai.example/v1/images/edits'));
  assert.ok(requests.every(request => request.headers.Authorization === 'Bearer secret-key' && !('Content-Type' in request.headers)));
  for (const request of requests) {
    const images = request.fields.filter(field => field.name === 'image[]');
    assert.deepEqual(images.map(image => image.filename), ['role_a-role-a.png', 'role_b-role-b.png']);
    assert.deepEqual(images.map(image => image.type), ['image/png', 'image/png']);
    assert.deepEqual(images.map(image => image.bytes), [localPortrait, linkedPortrait]);
    const prompt = request.fields.find(field => field.name === 'prompt').value;
    assert.match(prompt, /参考图 1 对应稳定角色 role_a“甲”/);
    assert.match(prompt, /参考图 2 对应稳定角色 role_b“乙”/);
    assert.doesNotMatch(prompt, /参考图 \d+ 对应稳定角色 narrator/);
  }
  await app.close();
});

test('switches from GPT Image to Gemini after 429 and preserves character reference uploads and audit fields', async () => {
  const { root, project } = await fixture();
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const portrait = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 4, 3, 2, 1]);
  const generated = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6]);
  await mkdir(path.join(projectDir, 'role-assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'role-assets', 'role-a.png'), portrait);
  project.roles.push(['role_a', '甲', 'character', '甲是主要人物，短发且面部轮廓清晰，跨镜头保持年龄与五官一致。', '中性清晰', '', '自然叙述', '否']);
  project.character_assets = { role_a: { portrait_url: '/api/projects/demo/role-assets/role-a.png' } };
  project.document = { scenes: [{ id: 'scene_fallback', title: '冷却切换', participants: ['role_a'], shots: [{
    id: 'shot_fallback', title: '走近窗边', participants: ['role_a'], start_segment_order: 1, end_segment_order: 1,
    storyboard_note: '甲从画面左侧走向窗边，面部保持角色参考图身份，窗框位于前景，冷光从右侧进入。', source_text: '甲走近窗边。',
  }] }] };
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  const requests = [];
  const remoteFetch = async (url, options) => {
    const fields = [];
    for (const [name, value] of options.body.entries()) fields.push(typeof value === 'string' ? { name, value } : { name, filename: value.name, bytes: Buffer.from(await value.arrayBuffer()) });
    requests.push({ url: String(url), fields });
    if (requests.length === 1) return new Response(JSON.stringify({ error: { message: 'RESOURCE_EXHAUSTED', code: 'quota' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '15' } });
    return new Response(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: {
    endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model',
    imageModel: 'gpt-image-2', imageFallbackModel: 'gemini-3-pro-image', imageFallbackEnabled: true,
  } });
  const opened = (await app.inject('/api/projects/demo')).json();
  const shot = opened.document.scenes[0].shots[0];
  const generatedResponse = await app.inject({ method: 'POST', url: '/api/projects/demo/scenes/scene_fallback/shots/shot_fallback/keyframe', payload: {
    shot, keyframeStyle: 'cinematic_realistic', imageModel: 'gpt-image-2', allowFallback: true,
  } });
  assert.equal(generatedResponse.statusCode, 200);
  assert.equal(generatedResponse.json().requestedModel, 'gpt-image-2');
  assert.equal(generatedResponse.json().model, 'gemini-3-pro-image');
  assert.equal(generatedResponse.json().modelFallbackUsed, true);
  assert.match(generatedResponse.json().modelFallbackReason, /RESOURCE_EXHAUSTED/);
  assert.equal(generatedResponse.json().modelPromptProfile, 'gemini_visual_spec_v1');
  assert.deepEqual(requests.map(request => request.url), ['https://ai.example/v1/images/edits', 'https://ai.example/v1/images/edits']);
  assert.deepEqual(requests.map(request => request.fields.find(field => field.name === 'model').value), ['gpt-image-2', 'gemini-3-pro-image']);
  for (const request of requests) {
    const image = request.fields.find(field => field.name === 'image[]');
    assert.equal(image.filename, 'role_a-role-a.png');
    assert.deepEqual(image.bytes, portrait);
  }
  assert.match(requests[0].fields.find(field => field.name === 'prompt').value, /GPT Image 执行说明/);
  assert.match(requests[1].fields.find(field => field.name === 'prompt').value, /Gemini 图像执行说明/);

  const beforeSecond = requests.length;
  const cooledResponse = await app.inject({ method: 'POST', url: '/api/projects/demo/scenes/scene_fallback/shots/shot_fallback/keyframe', payload: {
    shot, keyframeStyle: 'cinematic_realistic', imageModel: 'gpt-image-2', allowFallback: true,
  } });
  assert.equal(cooledResponse.statusCode, 200);
  assert.equal(requests.length, beforeSecond + 1);
  assert.equal(requests.at(-1).fields.find(field => field.name === 'model').value, 'gemini-3-pro-image');
  assert.match(cooledResponse.json().modelFallbackReason, /仍在冷却/);
  await app.close();
});

test('preflights missing character portraits before full keyframe generation and never switches after a non-cooldown edit rejection', async () => {
  const { root, project } = await fixture();
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const portrait = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2, 4, 6, 8]);
  await mkdir(path.join(projectDir, 'role-assets'), { recursive: true });
  await writeFile(path.join(projectDir, 'role-assets', 'ready.png'), portrait);
  project.roles = [
    project.roles[0],
    ['ready', '已就绪人物', 'character', '已就绪人物拥有完整角色形象，用于验证全量生成前的身份参考预检。', '中性清晰', '', '自然叙述', '否'],
    ['missing', '缺图人物', 'character', '缺图人物尚未生成角色形象，用于验证关键帧身份门禁和错误信息。', '中性清晰', '', '自然叙述', '否'],
  ];
  project.character_assets = { ready: { portrait_url: '/api/projects/demo/role-assets/ready.png' }, missing: {} };
  project.document = { scenes: [{ id: 'scene_gate', title: '身份门禁', storyboard_note: '人物依次进入明亮房间，镜头保持中景构图，门框和窗户构成前后景层次，光线从左侧进入。', participants: ['ready'], shots: [
    { id: 'shot_ready', storyboard_note: '已就绪人物站在门框左侧，镜头保持中景构图，窗户位于背景，光线从左侧进入。', participants: ['ready'], start_segment_order: 1, end_segment_order: 1 },
    { id: 'shot_missing', storyboard_note: '缺图人物站在窗边右侧，镜头保持中景构图，门框位于前景，光线从左侧进入。', participants: ['missing'], start_segment_order: 1, end_segment_order: 1 },
  ] }] };
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  const calls = [];
  const remoteFetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ error: { message: 'invalid reference image' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }); };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'secret-key', textModel: 'text-model', imageModel: 'gpt-image-2', imageFallbackModel: 'gemini-3-pro-image', imageFallbackEnabled: true } });
  const opened = (await app.inject('/api/projects/demo')).json();

  const full = await app.inject({ method: 'POST', url: '/api/projects/demo/storyboard/keyframes', payload: { shots: opened.document.scenes[0].shots, keyframeStyle: 'cinematic_realistic' } });
  assert.equal(full.statusCode, 400);
  assert.match(full.json().error, /缺少角色形象：缺图人物/);
  assert.deepEqual(calls, []);

  const single = await app.inject({ method: 'POST', url: '/api/projects/demo/scenes/scene_gate/shots/shot_ready/keyframe', payload: { shot: opened.document.scenes[0].shots[0], keyframeStyle: 'cinematic_realistic' } });
  assert.equal(single.statusCode, 400);
  assert.match(single.json().error, /Images Edits 多图参考/);
  assert.deepEqual(calls, ['https://ai.example/v1/images/edits']);
  await app.close();
});

test('strips compatible service credentials from cross-origin portrait downloads', async () => {
  const { root } = await fixture();
  const calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 5, 6, 7, 8]);
  const remoteFetch = async (url, options) => {
    calls.push({ url: String(url), headers: options?.headers || {} });
    if (String(url).endsWith('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/portrait.png' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'https://ai.example/v1', apiKey: 'secret-key', instanceId: '.portrait-agent', textModel: 'text-model', imageModel: 'image-model' } });
  const portrait = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/portrait', payload: { name: '旁白', profile: '负责全文叙事，并具有稳定人物设定和明确声音表达方式。', gender: 'unspecified', age: 40 } });
  assert.equal(portrait.statusCode, 200);
  assert.deepEqual(calls.map(call => call.url), ['https://ai.example/v1/images/generations', 'https://cdn.example/portrait.png']);
  assert.equal(calls[0].headers.Authorization, 'Bearer secret-key');
  assert.equal(calls[0].headers['X-Cockpit-Instance-Id'], '.portrait-agent');
  assert.deepEqual(calls[1].headers, {});
  await app.close();
});

test('keeps audio valid for portrait-only edits and invalidates the role after a pitch change', async () => {
  const { root } = await fixture();
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const renderDir = path.join(projectDir, 'renders', 'render-character');
  const processDir = path.join(projectDir, 'process');
  const cacheKey = '9'.repeat(64);
  await mkdir(path.join(processDir, 'segment-cache'), { recursive: true });
  await mkdir(renderDir, { recursive: true });
  await writeFile(path.join(processDir, 'segment-cache', `${cacheKey}.wav`), Buffer.from('RIFFcache'));
  await writeFile(path.join(processDir, 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: { [cacheKey]: { speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文' } } }));
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('RIFFfull'));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [{ speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文', cache_key: cacheKey }] }));
  const app = await buildApp({ repoRoot: root });
  const project = (await app.inject('/api/projects/demo')).json();
  project.character_assets.narrator.portrait_url = '/api/projects/demo/role-assets/portrait.png';
  const portraitSaved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(portraitSaved.statusCode, 200);
  assert.deepEqual(portraitSaved.json().artifact_invalidation, { invalidatedCacheKeys: [], staleRenders: 0 });
  await access(path.join(processDir, 'segment-cache', `${cacheKey}.wav`));
  await assert.rejects(access(path.join(renderDir, '.stale.json')));

  const pitchProject = portraitSaved.json();
  pitchProject.character_assets.narrator.pitch_target_hz += 10;
  const pitchSaved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: pitchProject });
  assert.equal(pitchSaved.statusCode, 200);
  assert.deepEqual(pitchSaved.json().artifact_invalidation, { invalidatedCacheKeys: [cacheKey], staleRenders: 1 });
  await assert.rejects(access(path.join(processDir, 'segment-cache', `${cacheKey}.wav`)));
  assert.equal(JSON.parse(await readFile(path.join(renderDir, '.stale.json'), 'utf8')).stale, true);
  await app.close();
});

test('normalizes per character voice controls and invalidates only the affected role', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const project = (await app.inject('/api/projects/demo')).json();
  assert.equal(project.character_assets.narrator.voice_generation.preset, 'balanced');
  assert.equal(project.character_assets.narrator.voice_generation.candidate_count, 3);
  assert.ok(project.character_assets.narrator.audition_text.length > 0);
  project.character_assets.narrator.voice_traits.roughness = 83;
  project.character_assets.narrator.voice_generation = { ...project.character_assets.narrator.voice_generation, preset: 'custom', temperature: 1.25, top_k: 90, candidate_count: 5 };
  project.character_assets.narrator.voice_generation_attempts = 36;
  project.character_assets.narrator.voice_candidate_generation_incomplete = true;
  project.character_assets.narrator.audition_text = '这是旁白独立使用的试听文本。';
  project.character_assets.narrator.voice_candidates = [{ voice_id: 'voice-verified', seed: 77, raw_median_pitch_hz: 196.4, median_pitch_hz: 218.5, pitch_delta_hz: 1.5, pitch_target_tolerance_hz: 10, pitch_target_matched: true, pitch_correction_semitones: 1.84, pitch_correction_method: 'librosa_phase_vocoder', pitch_calibration_version: 1, pitch_verified: true, selected: true, gender_verified: true, age_band_verified: true, gender_identity_verified: true, gender_identity_method: 'human_listening' }];
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().character_assets.narrator.voice_traits.roughness, 83);
  assert.equal(saved.json().character_assets.narrator.voice_generation.temperature, 1.25);
  assert.equal(saved.json().character_assets.narrator.voice_generation.candidate_count, 5);
  assert.equal(saved.json().character_assets.narrator.voice_generation_attempts, 36);
  assert.equal(saved.json().character_assets.narrator.voice_candidate_generation_incomplete, true);
  assert.equal(saved.json().character_assets.narrator.audition_text, '这是旁白独立使用的试听文本。');
  assert.deepEqual(saved.json().character_assets.narrator.voice_candidates, [{ voice_id: 'voice-verified', seed: 77, raw_median_pitch_hz: 196.4, median_pitch_hz: 218.5, pitch_delta_hz: 1.5, pitch_target_tolerance_hz: 10, pitch_target_matched: true, pitch_correction_semitones: 1.84, pitch_correction_method: 'librosa_phase_vocoder', pitch_calibration_version: 1, pitch_verified: true, selected: true, gender_verified: true, age_band_verified: true, gender_identity_verified: true, gender_identity_method: 'human_listening' }]);
  await app.close();
});

test('serves the latest audio with stable media headers', async () => {
  const { root, project } = await fixture();
  project.segments.push([2, '正文', 'narrator', '旁白', 'ZH', '新增', '新增', '中性叙述', '平静', 0.5, '自然', 300]);
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
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
  assert.equal(latest.json().mp3, '/api/projects/demo/render-file/render-001/mp3');
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

test('encodes a complete WAV to MP3 as a download stream without creating a stored MP3', async () => {
  const { root } = await fixture();
  const renderId = 'render-中文';
  const renderDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'renders', renderId);
  await mkdir(renderDir, { recursive: true });
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('RIFFsource'));
  let encodedFile;
  const app = await buildApp({ repoRoot: root, launchEncoder: file => {
    encodedFile = file;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.killed = false;
    child.kill = () => { child.killed = true; child.exitCode = 0; };
    queueMicrotask(() => {
      child.emit('spawn');
      child.stdout.end(Buffer.from('ID3encoded'));
      child.exitCode = 0;
      child.emit('close', 0);
    });
    return child;
  } });

  const response = await app.inject(`/api/projects/demo/render-file/${encodeURIComponent(renderId)}/mp3`);
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /^audio\/mpeg/);
  assert.equal(response.headers['content-disposition'], `attachment; filename="full-audio.mp3"; filename*=UTF-8''${encodeURIComponent(`${renderId}.mp3`)}`);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.rawPayload, Buffer.from('ID3encoded'));
  assert.equal(encodedFile, path.join(renderDir, 'full-audio.wav'));
  await assert.rejects(access(path.join(renderDir, 'full-audio.mp3')));
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
  assert.deepEqual(created.json().pronunciations, []);
  assert.deepEqual(created.json().director_memory.pronunciations, []);
  const commentary = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: '观点评论', content_type: 'commentary' } });
  assert.equal(commentary.statusCode, 201);
  assert.equal(commentary.json().content_type, 'commentary');
  const automatic = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: '自动分类稿件' } });
  assert.equal(automatic.statusCode, 201);
  assert.equal(automatic.json().content_type, 'auto');
  project.pronunciations = [{ source: '重庆银行', replacement: '重 庆 银行', note: '固定读法', enabled: true }];
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().chapters[0].title, '第一章');
  assert.equal(saved.json().segments[0][1], '第 1 章');
  assert.equal(saved.json().pronunciations[0].replacement, '重 庆 银行');
  assert.equal(saved.json().director_history.length, 1);
  assert.deepEqual(saved.json().director_history[0].changes, ['全篇纠音']);
  assert.equal('snapshot' in saved.json().director_history[0], false);
  assert.equal(saved.json().director_memory.pronunciations[0].replacement, '重 庆 银行');
  const persisted = JSON.parse(await readFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), 'utf8'));
  assert.equal(persisted.segments[0][1], '第 1 章');
  assert.equal(persisted.director_history[0].snapshot.pronunciations[0].replacement, '重 庆 银行');
  await app.close();
});

test('registers uploaded WAV as a permanent role reference voice and preserves its metadata on save', async () => {
  const { root } = await fixture();
  const conversions = [];
  const app = await buildApp({
    repoRoot: root,
    convertReferenceAudio: async (input, output) => {
      conversions.push({ input, output });
      await writeFile(output, await readFile(input));
    },
  });
  const source = pcmWav(1);
  const response = await app.inject({
    method: 'PUT',
    url: '/api/projects/demo/roles/narrator/reference-audio',
    headers: { 'content-type': 'audio/wav', 'x-audio-filename': encodeURIComponent('旁白 参考.wav') },
    payload: source,
  });

  assert.equal(response.statusCode, 200);
  const uploaded = response.json();
  assert.match(uploaded.voiceId, /^voice-upload-[0-9a-f]{16}$/);
  assert.equal(uploaded.originalName, '旁白 参考.wav');
  assert.equal(uploaded.sourceFormat, 'wav');
  assert.equal(uploaded.sizeBytes, source.length);
  assert.equal(uploaded.sampleRateHz, 24000);
  assert.equal(conversions.length, 1);
  const permanentWav = path.join(root, 'outputs', 'voice-library', `${uploaded.voiceId}.wav`);
  assert.deepEqual(await readFile(permanentWav), source);
  const metadata = JSON.parse(await readFile(path.join(root, 'outputs', 'voice-library', `${uploaded.voiceId}.json`), 'utf8'));
  assert.equal(metadata.original_name, '旁白 参考.wav');
  assert.equal(metadata.source, 'uploaded_reference_audio');
  const audio = await app.inject(`/api/voices/${uploaded.voiceId}/audio`);
  assert.equal(audio.statusCode, 200);
  assert.equal(audio.headers['content-type'], 'audio/wav');

  const project = (await app.inject('/api/projects/demo')).json();
  project.roles[0][5] = uploaded.voiceId;
  project.character_assets.narrator.reference_audio = {
    voice_id: uploaded.voiceId,
    original_name: uploaded.originalName,
    uploaded_at: uploaded.uploadedAt,
    source_format: uploaded.sourceFormat,
    size_bytes: uploaded.sizeBytes,
  };
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().roles[0][5], uploaded.voiceId);
  assert.equal(saved.json().character_assets.narrator.reference_audio.original_name, '旁白 参考.wav');
  assert.ok(saved.json().voice_files.includes(permanentWav));
  await app.close();
});

test('rejects content that only claims to be an MP3 reference audio file', async () => {
  const { root } = await fixture();
  let converted = false;
  const app = await buildApp({ repoRoot: root, convertReferenceAudio: async () => { converted = true; } });
  const response = await app.inject({
    method: 'PUT',
    url: '/api/projects/demo/roles/narrator/reference-audio',
    headers: { 'content-type': 'audio/mpeg', 'x-audio-filename': 'fake.mp3' },
    payload: Buffer.from('this is not an mp3 file'),
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /无法识别参考音频格式/);
  assert.equal(converted, false);
  await app.close();
});

test('queues a custom standard reference duration factor from the saved original upload', async () => {
  const { root, project } = await fixture();
  const sourceVoiceId = 'voice-upload-source';
  const voiceDir = path.join(root, 'outputs', 'voice-library');
  await mkdir(voiceDir, { recursive: true });
  await writeFile(path.join(voiceDir, `${sourceVoiceId}.wav`), pcmWav(1));
  project.roles[0][5] = sourceVoiceId;
  project.character_assets = { narrator: {
    gender: 'unspecified', age: 35, pitch_min_hz: 90, pitch_max_hz: 280, pitch_target_hz: 185,
    audition_text: '这是用于生成标准角色参考样本的固定试听文本。', voice_traits: {},
    voice_generation: { preset: 'balanced', candidate_count: 3 }, portrait_style: 'cinematic_manga',
    reference_audio: { voice_id: sourceVoiceId, original_name: 'source.wav', uploaded_at: '2026-09-04T00:00:00Z', source_format: 'wav', size_bytes: 100 },
  } };
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
  let child;
  let launch;
  const app = await buildApp({ repoRoot: root, launchWorker: value => {
    launch = value;
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child;
  } });

  const rejected = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/standard-reference', payload: { pacePreset: '自定义', durationFactor: 2.01, auditionText: '这是用于生成标准角色参考样本的固定试听文本。' } });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.json().error, /0\.50 至 2\.00/);

  const response = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/standard-reference', payload: { pacePreset: '自定义', durationFactor: 1.23, auditionText: '这是用于生成标准角色参考样本的固定试听文本。' } });

  assert.equal(response.statusCode, 202);
  assert.equal(response.json().kind, 'standardize');
  assert.equal(response.json().roleId, 'narrator');
  assert.equal(response.json().modelKey, 'indextts:index-tts-2.5');
  assert.ok(launch.args.some(value => value.endsWith('product_render_worker.py')));
  const input = JSON.parse(await readFile(path.join(root, 'runtime-output', 'product-jobs', response.json().jobId, 'input.json'), 'utf8'));
  assert.deepEqual(input.standard_reference, { role_id: 'narrator', pace_preset: '自定义', duration_factor: 1.23, audition_text: '这是用于生成标准角色参考样本的固定试听文本。', language: 'ZH' });
  const active = (await app.inject('/api/active-job')).json();
  assert.equal(active.kind, 'standardize');
  assert.equal(active.roleId, 'narrator');
  await writeFile(path.join(root, 'runtime-output', 'product-jobs', response.json().jobId, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完成' }));
  child.emit('close', 0);
  await new Promise(resolve => setTimeout(resolve, 20));
  await assert.rejects(access(path.join(root, 'outputs', 'novel-projects', 'demo', 'process', 'standard-reference-staging')));
  await app.close();
});

test('adopts only a passing standard reference candidate and restores the original atomically', async () => {
  const { root, project } = await fixture();
  const voiceDir = path.join(root, 'outputs', 'voice-library');
  await mkdir(voiceDir, { recursive: true });
  for (const voiceId of ['voice-upload-source', 'voice-standard-passing', 'voice-standard-failed']) {
    await writeFile(path.join(voiceDir, `${voiceId}.wav`), pcmWav(1));
  }
  project.roles[0][5] = 'voice-upload-source';
  project.character_assets = { narrator: {
    gender: 'unspecified', age: 35, pitch_min_hz: 90, pitch_max_hz: 280, pitch_target_hz: 185,
    audition_text: '这是用于生成标准角色参考样本的固定试听文本。', voice_traits: {},
    voice_generation: { preset: 'balanced', candidate_count: 3 }, portrait_style: 'cinematic_manga',
  } };
  project.character_assets.narrator.reference_audio = { voice_id: 'voice-upload-source', original_name: 'source.wav', uploaded_at: '2026-09-04T00:00:00Z', source_format: 'wav', size_bytes: 100 };
  project.character_assets.narrator.standard_reference = {
    source_voice_id: 'voice-upload-source', audition_text: '这是标准试听文本。', pace_preset: '舒缓', duration_factor: 1.18, generated_at: '2026-09-04T00:01:00Z',
    candidates: [
      { voice_id: 'voice-standard-passing', rank: 1, duration_seconds: 3, audio_quality_passed: true, speaker_similarity: 0.86, speaker_similarity_threshold: 0.72, speaker_verified: true, echo_similarity: 0.12, echo_threshold: 0.72, echo_verified: true, quality_passed: true, score: 102, selected: false, generated_at: '2026-09-04T00:01:00Z' },
      { voice_id: 'voice-standard-failed', rank: 2, duration_seconds: 3, audio_quality_passed: true, speaker_similarity: 0.51, speaker_similarity_threshold: 0.72, speaker_verified: false, echo_similarity: 0.14, echo_threshold: 0.72, echo_verified: true, quality_passed: false, score: 70, selected: false, generated_at: '2026-09-04T00:01:00Z' },
    ],
  };
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
  const app = await buildApp({ repoRoot: root });

  const rejected = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/standard-reference/candidates/voice-standard-failed/adopt', payload: {} });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.json().error, /未通过全部自动门禁/);

  const adopted = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/standard-reference/candidates/voice-standard-passing/adopt', payload: {} });
  assert.equal(adopted.statusCode, 200);
  assert.equal(adopted.json().roles[0][5], 'voice-standard-passing');
  assert.equal(adopted.json().character_assets.narrator.reference_audio.voice_id, 'voice-upload-source');
  assert.deepEqual(adopted.json().character_assets.narrator.standard_reference.candidates.map(item => item.selected), [true, false]);
  assert.ok(adopted.json().artifact_invalidation);

  const restored = await app.inject({ method: 'POST', url: '/api/projects/demo/roles/narrator/standard-reference/restore', payload: {} });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().roles[0][5], 'voice-upload-source');
  assert.equal(restored.json().character_assets.narrator.standard_reference.adopted_voice_id, 'voice-standard-passing');
  assert.ok(restored.json().character_assets.narrator.standard_reference.restored_at);
  assert.deepEqual(restored.json().character_assets.narrator.standard_reference.candidates.map(item => item.selected), [false, false]);
  const persisted = JSON.parse(await readFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), 'utf8'));
  assert.equal(persisted.roles[0][5], 'voice-upload-source');
  await app.close();
});

test('accepts one legacy large save and returns compact director history summaries', async () => {
  const { root, project } = await fixture();
  project.director_history = [{
    operation_id: 'legacy-history',
    recorded_at: '2026-09-01T00:00:00.000Z',
    actor: 'studio-user',
    changes: ['合成文字与导演参数'],
    snapshot: { source_text: 'x'.repeat(26 * 1024 * 1024) },
  }];
  await writeFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), JSON.stringify(project));
  const app = await buildApp({ repoRoot: root });

  const response = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().director_history.length, 1);
  assert.equal('snapshot' in response.json().director_history[0], false);
  assert.ok(response.rawPayload.length < 1024 * 1024);
  const persisted = JSON.parse(await readFile(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'), 'utf8'));
  assert.equal(persisted.director_history[0].snapshot.source_text.length, 26 * 1024 * 1024);
  await app.close();
});

test('creates a project linked to multiple sources and imports every role voice candidate with collision-safe role ids', async () => {
  const { root } = await fixture();
  const projectRoot = path.join(root, 'outputs', 'novel-projects');
  const voiceRoot = path.join(root, 'outputs', 'voice-library');
  await mkdir(voiceRoot, { recursive: true });
  for (const voiceId of ['voice-current', 'voice-candidate-a', 'voice-candidate-b']) {
    await writeFile(path.join(voiceRoot, `${voiceId}.wav`), Buffer.from(`RIFF${voiceId}`));
  }
  const demoPath = path.join(projectRoot, 'demo', 'project.json');
  const demo = JSON.parse(await readFile(demoPath, 'utf8'));
  demo.roles[0][5] = 'voice-current';
  demo.character_assets = { narrator: { voice_candidates: [
    { voice_id: 'voice-current', seed: 1, selected: true, gender_verified: true },
    { voice_id: 'voice-candidate-a', seed: 2, selected: false, gender_verified: true },
    { voice_id: 'voice-missing', seed: 3, selected: false, gender_verified: true },
  ] } };
  demo.pronunciations = [
    { source: '重庆银行', replacement: '重 庆 银行', note: '共同规则', enabled: true },
    { source: '朝阳', replacement: '朝 阳', note: '首来源优先', enabled: true },
  ];
  await writeFile(demoPath, JSON.stringify(demo));
  const secondDir = path.join(projectRoot, 'second');
  await mkdir(secondDir, { recursive: true });
  await writeFile(path.join(secondDir, 'project.json'), JSON.stringify({
    ...demo,
    project_id: 'second',
    title: '第二工程',
    roles: [['narrator', '第二旁白', 'narrator', '第二工程旁白。', '中性清晰', 'voice-candidate-b', '自然叙述', '否']],
    character_assets: { narrator: { voice_candidates: [{ voice_id: 'voice-candidate-b', seed: 4, selected: true, gender_verified: true }] } },
    pronunciations: [
      { source: '重庆银行', replacement: '重 庆 银行', note: '共同规则', enabled: true },
      { source: '朝阳', replacement: '朝阳', note: '第二来源冲突', enabled: true },
      { source: '甄嬛', replacement: '真 环', note: '第二来源独有', enabled: true },
    ],
  }));
  demo.director_history = [{ snapshot: { source_text: '大体积历史不应进入角色导入规范化', segments: Array.from({ length: 500 }, (_, index) => [index + 1, '正文']) } }];
  await writeFile(demoPath, JSON.stringify(demo));
  const app = await buildApp({ repoRoot: root });

  const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: '关联工程', content_type: 'novel', source_project_ids: ['demo', 'second', 'demo'] } });

  assert.equal(created.statusCode, 201);
  const payload = created.json();
  assert.deepEqual(payload.roles.map(role => role[0]), ['narrator', 'narrator-2']);
  assert.deepEqual(payload.character_assets.narrator.voice_candidates.map(candidate => candidate.voice_id), ['voice-current', 'voice-candidate-a', 'voice-missing']);
  assert.deepEqual(payload.voice_files.map(file => path.basename(file)).sort(), ['voice-candidate-a.wav', 'voice-candidate-b.wav', 'voice-current.wav']);
  assert.deepEqual(payload.linked_projects.map(link => link.source_project_id), ['demo', 'second']);
  assert.deepEqual(payload.linked_projects[0].roles[0].available_voice_ids, ['voice-current', 'voice-candidate-a']);
  assert.deepEqual(payload.linked_projects[0].roles[0].missing_voice_ids, ['voice-missing']);
  assert.deepEqual(payload.pronunciations, [
    { source: '重庆银行', replacement: '重 庆 银行', note: '共同规则', enabled: true },
    { source: '朝阳', replacement: '朝 阳', note: '首来源优先', enabled: true },
    { source: '甄嬛', replacement: '真 环', note: '第二来源独有', enabled: true },
  ]);
  assert.equal(payload.linked_projects[0].pronunciations.imported_count, 2);
  assert.deepEqual(payload.linked_projects[0].pronunciations.duplicate_rules, []);
  assert.deepEqual(payload.linked_projects[0].pronunciations.conflict_rules, []);
  assert.equal(payload.linked_projects[1].pronunciations.imported_count, 1);
  assert.deepEqual(payload.linked_projects[1].pronunciations.duplicate_rules, [
    { source: '重庆银行', kept_source_project_id: 'demo' },
  ]);
  assert.deepEqual(payload.linked_projects[1].pronunciations.conflict_rules, [
    { source: '朝阳', kept_source_project_id: 'demo', kept_replacement: '朝 阳', ignored_replacement: '朝阳' },
  ]);
  assert.deepEqual(payload.director_memory.roles, payload.roles);
  assert.deepEqual(payload.director_memory.pronunciations, payload.pronunciations);
  const reopened = (await app.inject(`/api/projects/${payload.project_id}`)).json();
  assert.deepEqual(reopened.linked_projects, payload.linked_projects);
  assert.deepEqual(reopened.pronunciations, payload.pronunciations);
  assert.deepEqual(reopened.director_memory.pronunciations, payload.pronunciations);
  await app.close();
});

test('rejects an unreadable linked source before creating a project directory', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const before = (await app.inject('/api/projects')).json().map(item => item.value).sort();

  const response = await app.inject({ method: 'POST', url: '/api/projects', payload: { title: '错误关联', content_type: 'novel', source_project_ids: ['missing-project'] } });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /关联来源工程不存在或无法读取/);
  const after = (await app.inject('/api/projects')).json().map(item => item.value).sort();
  assert.deepEqual(after, before);
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

test('invalidates a deleted segment while preserving and resequencing later matching audio', async () => {
  const { root, project } = await fixture();
  const deletedKey = 'd'.repeat(64);
  const preservedKey = 'e'.repeat(64);
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const renderDir = path.join(projectDir, 'renders', 'render-delete-segment');
  const cacheDir = path.join(projectDir, 'process', 'segment-cache');
  const row = (order, text) => [order, '正文', 'narrator', '旁白', 'ZH', text, text, '中性叙述', '平静', 0.5, '自然', 300];
  project.segments = [row(1, '保留第一句。'), row(2, '删除这条注释。'), row(3, '保留第三句。')];
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  await mkdir(path.join(renderDir, 'segments'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('full'));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { order: 2, speaker_id: 'narrator', speaker_name: '旁白', language: 'ZH', source_text: '删除这条注释。', text: '删除这条注释。', cache_key: deletedKey, audio: 'segments/0002.wav' },
    { order: 3, speaker_id: 'narrator', speaker_name: '旁白', language: 'ZH', source_text: '保留第三句。', text: '保留第三句。', cache_key: preservedKey, audio: 'segments/0003.wav' },
  ] }));
  await writeFile(path.join(renderDir, 'segments', '0002.wav'), pcmWav(0.2));
  await writeFile(path.join(renderDir, 'segments', '0003.wav'), pcmWav(0.2));
  await writeFile(path.join(cacheDir, `${deletedKey}.wav`), Buffer.from('deleted'));
  await writeFile(path.join(cacheDir, `${preservedKey}.wav`), Buffer.from('preserved'));
  await writeFile(path.join(projectDir, 'process', 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: {
    [deletedKey]: { order: 2, speaker_id: 'narrator', language: 'ZH', source_text: '删除这条注释。', text: '删除这条注释。', audio_file: `${deletedKey}.wav` },
    [preservedKey]: { order: 3, speaker_id: 'narrator', language: 'ZH', source_text: '保留第三句。', text: '保留第三句。', audio_file: `${preservedKey}.wav` },
  } }));
  const app = await buildApp({ repoRoot: root });

  project.segments = [row(1, '保留第一句。'), row(2, '保留第三句。')];
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });

  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().artifact_invalidation, { invalidatedCacheKeys: [deletedKey], staleRenders: 1 });
  await assert.rejects(access(path.join(cacheDir, `${deletedKey}.wav`)));
  await access(path.join(cacheDir, `${preservedKey}.wav`));
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.stale, true);
  assert.equal(latest.fragments.length, 1);
  assert.equal(latest.fragments[0].order, 2);
  assert.equal(latest.fragments[0].sourceText, '保留第三句。');
  await app.close();
});

test('invalidates only the edited segment when its emotion direction changes', async () => {
  const { root, project } = await fixture();
  const firstKey = '3'.repeat(64);
  const secondKey = '4'.repeat(64);
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const renderDir = path.join(projectDir, 'renders', 'render-emotion');
  const cacheDir = path.join(projectDir, 'process', 'segment-cache');
  project.segments.push([2, '正文', 'narrator', '旁白', 'ZH', '第二句', '第二句', '中性叙述', '平静', 0.5, '自然', 300]);
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  await mkdir(path.join(renderDir, 'segments'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const fragments = {
    [firstKey]: { order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文' },
    [secondKey]: { order: 2, speaker_id: 'narrator', language: 'ZH', source_text: '第二句', text: '第二句' },
  };
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('full'));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { ...fragments[firstKey], cache_key: firstKey, audio: 'segments/0001.wav' },
    { ...fragments[secondKey], cache_key: secondKey, audio: 'segments/0002.wav' },
  ] }));
  await writeFile(path.join(cacheDir, `${firstKey}.wav`), Buffer.from('first'));
  await writeFile(path.join(cacheDir, `${secondKey}.wav`), Buffer.from('second'));
  await writeFile(path.join(projectDir, 'process', 'segment-fragments.json'), JSON.stringify({ version: 1, fragments }));
  const app = await buildApp({ repoRoot: root });

  project.segments[0].push('sly_smile', '句尾带一点得意的气声');
  project.segments[0][9] = 0.8;
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().artifact_invalidation, { invalidatedCacheKeys: [firstKey], staleRenders: 1 });
  await assert.rejects(access(path.join(cacheDir, `${firstKey}.wav`)));
  await access(path.join(cacheDir, `${secondKey}.wav`));
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.stale, true);
  assert.deepEqual(latest.fragments.map(item => item.order), [2]);
  await app.close();
});

test('keeps every generated fragment when a new pronunciation rule matches no segment', async () => {
  const { root, project } = await fixture();
  const firstKey = '1'.repeat(64);
  const secondKey = '2'.repeat(64);
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const renderDir = path.join(projectDir, 'renders', 'render-current');
  const cacheDir = path.join(projectDir, 'process', 'segment-cache');
  project.segments.push([2, '正文', 'narrator', '旁白', 'ZH', '第二句', '第二句', '中性叙述', '平静', 0.5, '自然', 300]);
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  await mkdir(path.join(renderDir, 'segments'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const fragments = {
    [firstKey]: { order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '原文', text: '原文' },
    [secondKey]: { order: 2, speaker_id: 'narrator', language: 'ZH', source_text: '第二句', text: '第二句' },
  };
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { ...fragments[firstKey], cache_key: firstKey, audio: 'segments/0001.wav' },
    { ...fragments[secondKey], cache_key: secondKey, audio: 'segments/0002.wav' },
  ] }));
  await writeFile(path.join(cacheDir, `${firstKey}.wav`), Buffer.from('first'));
  await writeFile(path.join(cacheDir, `${secondKey}.wav`), Buffer.from('second'));
  await writeFile(path.join(projectDir, 'process', 'segment-fragments.json'), JSON.stringify({ version: 1, fragments }));
  const app = await buildApp({ repoRoot: root });

  project.pronunciations = [{ source: '未出现词', replacement: '新读法', note: '', enabled: true }];
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().artifact_invalidation, { invalidatedCacheKeys: [], staleRenders: 0 });
  await access(path.join(cacheDir, `${firstKey}.wav`));
  await access(path.join(cacheDir, `${secondKey}.wav`));
  await assert.rejects(access(path.join(renderDir, '.stale.json')));
  const index = JSON.parse(await readFile(path.join(projectDir, 'process', 'segment-fragments.json'), 'utf8'));
  assert.deepEqual(new Set(Object.keys(index.fragments)), new Set([firstKey, secondKey]));
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.stale, false);
  assert.equal(latest.fragments.length, 2);
  await app.close();
});

test('invalidates only the fragment whose effective pronunciation changes', async () => {
  const { root, project } = await fixture();
  const affectedKey = '3'.repeat(64);
  const preservedKey = '4'.repeat(64);
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const renderDir = path.join(projectDir, 'renders', 'render-current');
  const unrelatedRenderDir = path.join(projectDir, 'renders', 'render-unrelated');
  const cacheDir = path.join(projectDir, 'process', 'segment-cache');
  project.segments[0][5] = '笹垣出现了';
  project.segments[0][6] = '笹垣出现了';
  project.segments.push([2, '正文', 'narrator', '旁白', 'ZH', '第二句', '第二句', '中性叙述', '平静', 0.5, '自然', 300]);
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  await mkdir(path.join(renderDir, 'segments'), { recursive: true });
  await mkdir(path.join(unrelatedRenderDir, 'segments'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const fragments = {
    [affectedKey]: { order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '笹垣出现了', text: '笹垣出现了' },
    [preservedKey]: { order: 2, speaker_id: 'narrator', language: 'ZH', source_text: '第二句', text: '第二句' },
  };
  await writeFile(path.join(unrelatedRenderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { ...fragments[preservedKey], cache_key: preservedKey, audio: 'segments/0002.wav' },
  ] }));
  await writeFile(path.join(renderDir, 'full-audio.wav'), Buffer.from('full'));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { ...fragments[affectedKey], cache_key: affectedKey, audio: 'segments/0001.wav' },
    { ...fragments[preservedKey], cache_key: preservedKey, audio: 'segments/0002.wav' },
  ] }));
  await writeFile(path.join(cacheDir, `${affectedKey}.wav`), Buffer.from('affected'));
  await writeFile(path.join(cacheDir, `${preservedKey}.wav`), Buffer.from('preserved'));
  await writeFile(path.join(projectDir, 'process', 'segment-fragments.json'), JSON.stringify({ version: 1, fragments }));
  const app = await buildApp({ repoRoot: root });

  project.pronunciations = [{ source: '笹垣', replacement: '世元', note: '', enabled: true }];
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().artifact_invalidation, { invalidatedCacheKeys: [affectedKey], staleRenders: 1 });
  await assert.rejects(access(path.join(cacheDir, `${affectedKey}.wav`)));
  await access(path.join(cacheDir, `${preservedKey}.wav`));
  await access(path.join(renderDir, 'full-audio.wav'));
  await assert.rejects(access(path.join(unrelatedRenderDir, '.stale.json')));
  const index = JSON.parse(await readFile(path.join(projectDir, 'process', 'segment-fragments.json'), 'utf8'));
  assert.deepEqual(Object.keys(index.fragments), [preservedKey]);
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.stale, true);
  assert.deepEqual(latest.staleReasons, ['全篇纠音']);
  assert.equal(latest.fragments.length, 1);
  assert.equal(latest.fragments[0].sourceText, '第二句');
  await app.close();
});

test('invalidates only matching fragments when an enabled pronunciation is disabled', async () => {
  const { root, project } = await fixture();
  const affectedKey = '5'.repeat(64);
  const preservedKey = '6'.repeat(64);
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  const renderDir = path.join(projectDir, 'renders', 'render-current');
  const cacheDir = path.join(projectDir, 'process', 'segment-cache');
  project.segments[0][5] = '近畿地方';
  project.segments[0][6] = '近畿地方';
  project.segments.push([2, '正文', 'narrator', '旁白', 'ZH', '近处地方', '近处地方', '中性叙述', '平静', 0.5, '自然', 300]);
  project.pronunciations = [
    { source: '近畿', replacement: '近机', note: '', enabled: true },
    { source: '近', replacement: '进', note: '', enabled: true },
  ];
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  await mkdir(path.join(renderDir, 'segments'), { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const fragments = {
    [affectedKey]: { order: 1, speaker_id: 'narrator', language: 'ZH', source_text: '近畿地方', text: '近畿地方' },
    [preservedKey]: { order: 2, speaker_id: 'narrator', language: 'ZH', source_text: '近处地方', text: '近处地方' },
  };
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { ...fragments[affectedKey], cache_key: affectedKey, audio: 'segments/0001.wav' },
    { ...fragments[preservedKey], cache_key: preservedKey, audio: 'segments/0002.wav' },
  ] }));
  await writeFile(path.join(cacheDir, `${affectedKey}.wav`), Buffer.from('affected'));
  await writeFile(path.join(cacheDir, `${preservedKey}.wav`), Buffer.from('preserved'));
  await writeFile(path.join(projectDir, 'process', 'segment-fragments.json'), JSON.stringify({ version: 1, fragments }));
  const app = await buildApp({ repoRoot: root });

  project.pronunciations[0].enabled = false;
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().artifact_invalidation, { invalidatedCacheKeys: [affectedKey], staleRenders: 1 });
  await assert.rejects(access(path.join(cacheDir, `${affectedKey}.wav`)));
  await access(path.join(cacheDir, `${preservedKey}.wav`));
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.fragments.length, 1);
  assert.equal(latest.fragments[0].sourceText, '近处地方');
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
  await writeFile(path.join(root, 'runtime-output', 'product-jobs', assembled.json().jobId, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完成' }));
  child.emit('close', 0);
  await new Promise(resolve => setTimeout(resolve, 20));

  const regenerated = await app.inject({ method: 'POST', url: '/api/projects/demo/segments/1/regenerate', payload: { advanced: true } });
  assert.equal(regenerated.statusCode, 202);
  await waitForLaunches(launches, 2);
  input = JSON.parse(await readFile(launches[1].args[2], 'utf8'));
  assert.deepEqual(input.fragment_only_orders, [1]);
  assert.deepEqual(input.advanced_segment_orders, [1]);
  await writeFile(path.join(root, 'runtime-output', 'product-jobs', regenerated.json().jobId, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完成' }));
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
  assert.deepEqual(migrated.segments[0].slice(12), ['auto', '', '', 1, 'none', 'standard']);
  await app.close();
});

test('returns three auditable segment candidates and adopts the user selection', async () => {
  const { root } = await fixture();
  const processDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'process');
  const cacheKey = 'a'.repeat(64);
  const candidates = ['1'.repeat(16), '2'.repeat(16), '3'.repeat(16)];
  const olderKey = 'b'.repeat(64);
  await mkdir(path.join(processDir, 'segment-cache'), { recursive: true });
  await mkdir(path.join(processDir, 'segment-candidates', cacheKey), { recursive: true });
  await writeFile(path.join(processDir, 'segment-cache', `${cacheKey}.wav`), Buffer.from('first'));
  for (const [index, candidateId] of candidates.entries()) await writeFile(path.join(processDir, 'segment-candidates', cacheKey, `${candidateId}.wav`), Buffer.from(`candidate-${index + 1}`));
  await writeFile(path.join(processDir, 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: { [olderKey]: {
    order: 1, speaker_name: '旁白', source_text: '旧原文', text: '旧原文', effective_text: '旧原文', applied_pronunciations: [],
  }, [cacheKey]: {
    order: 1, speaker_name: '旁白', source_text: '原文', text: '原文', effective_text: '原文', applied_pronunciations: [], stress_word: '原', stress_level: 'strong', selected_candidate_id: candidates[0],
    candidate_results: candidates.map((candidate_id, index) => ({ candidate_id, rank: index + 1, selected: index === 0, score: 90 - index, stress_db: 3 - index, audio_quality_passed: true, quality_passed: index < 2, stress_verified: index === 0, alignment_method: 'text_proportional_proxy_v1', speaker_similarity: 0.84 - index * 0.08, speaker_similarity_threshold: 0.72, speaker_verified: index < 2, speaker_validation_method: 'campplus_cosine_v1', director_verified: false, director_validation_method: 'human_listening_required' })),
  } } }));
  const app = await buildApp({ repoRoot: root });

  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.available, false);
  assert.equal(latest.fragments.length, 1);
  assert.equal(latest.fragments[0].sourceText, '原文');
  assert.equal(latest.fragments[0].candidates.length, 3);
  assert.equal(latest.fragments[0].candidates[0].speakerSimilarity, 0.84);
  assert.equal(latest.fragments[0].candidates[2].qualityPassed, false);
  const selected = await app.inject({ method: 'POST', url: `/api/projects/demo/segments/1/candidates/${candidates[1]}/select`, payload: {} });
  assert.equal(selected.statusCode, 200);
  assert.equal((await readFile(path.join(processDir, 'segment-cache', `${cacheKey}.wav`), 'utf8')), 'candidate-2');
  const index = JSON.parse(await readFile(path.join(processDir, 'segment-fragments.json'), 'utf8'));
  assert.equal(index.fragments[cacheKey].selected_candidate_id, candidates[1]);
  assert.deepEqual(index.fragments[cacheKey].candidate_results.map(item => item.selected), [false, true, false]);
  const overridden = await app.inject({ method: 'POST', url: `/api/projects/demo/segments/1/candidates/${candidates[2]}/select`, payload: {} });
  assert.equal(overridden.statusCode, 200);
  assert.equal(overridden.json().manualOverride, true);
  assert.equal((await readFile(path.join(processDir, 'segment-cache', `${cacheKey}.wav`), 'utf8')), 'candidate-3');
  const overriddenIndex = JSON.parse(await readFile(path.join(processDir, 'segment-fragments.json'), 'utf8'));
  assert.equal(overriddenIndex.fragments[cacheKey].candidate_results[2].manual_override, true);
  assert.equal(overriddenIndex.fragments[cacheKey].candidate_results[2].manual_selection_method, 'human_listening_accepted');
  await app.close();
});

test('fails legacy segment candidates closed when speaker identity evidence is missing', async () => {
  const { root } = await fixture();
  const processDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'process');
  const cacheKey = 'c'.repeat(64);
  const candidateId = '4'.repeat(16);
  await mkdir(path.join(processDir, 'segment-cache'), { recursive: true });
  await mkdir(path.join(processDir, 'segment-candidates', cacheKey), { recursive: true });
  await writeFile(path.join(processDir, 'segment-cache', `${cacheKey}.wav`), Buffer.from('legacy'));
  await writeFile(path.join(processDir, 'segment-candidates', cacheKey, `${candidateId}.wav`), Buffer.from('legacy-candidate'));
  await writeFile(path.join(processDir, 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: { [cacheKey]: {
    order: 1, speaker_name: '旁白', source_text: '原文', text: '原文', effective_text: '原文', selected_candidate_id: candidateId,
    candidate_results: [{ candidate_id: candidateId, rank: 1, selected: true, score: 20, stress_db: 0, quality_passed: true, stress_verified: false, alignment_method: 'text_proportional_proxy_v1' }],
  } } }));
  const app = await buildApp({ repoRoot: root });

  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.equal(latest.fragments[0].candidates[0].audioQualityPassed, false);
  assert.equal(latest.fragments[0].candidates[0].speakerVerified, false);
  assert.equal(latest.fragments[0].candidates[0].qualityPassed, false);
  const selected = await app.inject({ method: 'POST', url: `/api/projects/demo/segments/1/candidates/${candidateId}/select`, payload: {} });
  assert.equal(selected.statusCode, 200);
  assert.equal(selected.json().manualOverride, true);
  await app.close();
});

test('persists detailed segment emotion direction and validates custom descriptions', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const project = (await app.inject('/api/projects/demo')).json();
  project.segments[0][9] = 0.85;
  project.segments[0][12] = 'urgent_question';
  project.segments[0][13] = '句尾继续上扬，保持追问压力';
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().segments[0].slice(9, 14), [0.85, '自然', 300, 'urgent_question', '句尾继续上扬，保持追问压力']);

  const invalid = structuredClone(saved.json());
  invalid.segments[0][12] = 'custom';
  invalid.segments[0][13] = '';
  const rejected = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: invalid });
  assert.equal(rejected.statusCode, 400);
  assert.match(rejected.json().error, /必须填写细化描述/);
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

test('queues a dependent job for the same project and propagates an earlier failure', async () => {
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
  assert.equal(active.json().available, true);
  assert.equal(active.json().jobId, started.json().jobId);
  assert.equal(active.json().kind, 'analyze');
  assert.equal(active.json().projectId, 'demo');
  assert.equal(active.json().phase, 'queued');
  assert.equal(active.json().modelKey, 'director:ollama:http://127.0.0.1:11434:qwen3:14b');
  assert.deepEqual(active.json().dependencies, []);
  const lockedSave = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(lockedSave.statusCode, 409);
  assert.match(lockedSave.json().error, /工程版本已被任务.*锁定/);
  const lockedDelete = await app.inject({ method: 'DELETE', url: '/api/projects/demo' });
  assert.equal(lockedDelete.statusCode, 409);
  assert.match(lockedDelete.json().error, /工程版本已被任务.*锁定/);
  await access(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'));
  const queued = await app.inject({ method: 'POST', url: '/api/projects/demo/render', payload: {} });
  assert.equal(queued.statusCode, 202);
  assert.deepEqual(queued.json().dependencies, [started.json().jobId]);
  const queuedStatus = (await app.inject(`/api/jobs/${queued.json().jobId}`)).json();
  assert.equal(queuedStatus.phase, 'queued');
  assert.match(queuedStatus.message, /等待依赖任务完成/);
  child.stderr.write('fixture worker failed');
  child.stderr.end();
  child.stdout.end();
  child.emit('close', 17);
  await new Promise(resolve => setTimeout(resolve, 30));
  const status = await app.inject(`/api/jobs/${started.json().jobId}`);
  assert.equal(status.json().phase, 'error');
  assert.match(status.json().message, /fixture worker failed/);
  const dependentStatus = await app.inject(`/api/jobs/${queued.json().jobId}`);
  assert.equal(dependentStatus.json().phase, 'error');
  assert.match(dependentStatus.json().message, /依赖任务.*未成功/);
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
  const unlockedSave = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(unlockedSave.statusCode, 200);
  const restarted = await app.inject({ method: 'POST', url: '/api/projects/demo/render', payload: {} });
  assert.equal(restarted.statusCode, 202);
  child.emit('close', 0);
  await app.close();
});

test('returns JSON and keeps the server alive when the worker executable cannot spawn', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root, spawnWorker: () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn /missing/python ENOENT'), { code: 'ENOENT' })));
    return child;
  } });

  const response = await app.inject({ method: 'POST', url: '/api/projects/demo/voices', payload: {} });
  assert.equal(response.statusCode, 202);
  assert.match(response.headers['content-type'], /^application\/json/);
  await new Promise(resolve => setTimeout(resolve, 20));
  const failed = await app.inject(`/api/jobs/${response.json().jobId}`);
  assert.equal(failed.json().phase, 'error');
  assert.match(failed.json().message, /ENOENT/);
  assert.equal((await app.inject('/api/health')).statusCode, 200);
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
  await app.close();
});

test('runs independent work for the resident model before switching models', async () => {
  const { root, project } = await fixture();
  for (const projectId of ['voice-project', 'render-project']) {
    const directory = path.join(root, 'outputs', 'novel-projects', projectId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'project.json'), JSON.stringify({ ...project, project_id: projectId, title: projectId }));
  }
  const children = [];
  const app = await buildApp({ repoRoot: root, launchWorker: () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    children.push(child);
    return child;
  } });

  const firstRender = (await app.inject({ method: 'POST', url: '/api/projects/demo/render', payload: {} })).json();
  const waitingVoice = (await app.inject({ method: 'POST', url: '/api/projects/voice-project/voices', payload: {} })).json();
  const waitingRender = (await app.inject({ method: 'POST', url: '/api/projects/render-project/render', payload: {} })).json();
  assert.equal(children.length, 1);
  assert.deepEqual(waitingVoice.dependencies, []);
  assert.deepEqual(waitingRender.dependencies, []);

  await writeFile(path.join(root, 'runtime-output', 'product-jobs', firstRender.jobId, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完成' }));
  children[0].emit('close', 0);
  const secondActive = await waitForActiveJob(app, waitingRender.jobId);
  assert.equal(secondActive.jobId, waitingRender.jobId);
  assert.equal(secondActive.modelKey, 'indextts:index-tts-2.5');
  assert.equal(children.length, 2);

  await writeFile(path.join(root, 'runtime-output', 'product-jobs', waitingRender.jobId, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完成' }));
  children[1].emit('close', 0);
  const thirdActive = await waitForActiveJob(app, waitingVoice.jobId);
  assert.equal(thirdActive.jobId, waitingVoice.jobId);
  assert.equal(thirdActive.modelKey, 'voice-design:qwen3-tts-1.7b');

  await writeFile(path.join(root, 'runtime-output', 'product-jobs', waitingVoice.jobId, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完成' }));
  children[2].emit('close', 0);
  await new Promise(resolve => setTimeout(resolve, 30));
  await app.close();
});

test('restores a persisted waiting job and dispatches it after service startup', async () => {
  const { root } = await fixture();
  const jobId = 'persistedqueuejob';
  const jobDir = path.join(root, 'runtime-output', 'product-jobs', jobId);
  await mkdir(jobDir, { recursive: true });
  await writeFile(path.join(jobDir, 'input.json'), JSON.stringify({ root, project_id: 'demo' }));
  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'queued', fraction: 0, message: '等待服务恢复' }));
  await writeFile(path.join(root, 'runtime-output', 'product-jobs', 'job-queue.json'), JSON.stringify({
    version: 1,
    last_model_key: 'indextts:index-tts-2.5',
    pending: [{ jobId, kind: 'render', projectId: 'demo', modelKey: 'indextts:index-tts-2.5', dependencies: [], createdAt: '2026-08-30T00:00:00.000Z' }],
  }));
  let child;
  const app = await buildApp({ repoRoot: root, launchWorker: () => {
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child;
  } });

  const active = (await app.inject('/api/active-job')).json();
  assert.equal(active.jobId, jobId);
  assert.equal(active.modelKey, 'indextts:index-tts-2.5');
  assert.deepEqual(active.dependencies, []);
  const persisted = JSON.parse(await readFile(path.join(root, 'runtime-output', 'product-jobs', 'job-queue.json'), 'utf8'));
  assert.deepEqual(persisted.pending, []);

  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完成' }));
  child.emit('close', 0);
  await new Promise(resolve => setTimeout(resolve, 30));
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
  const observed = (await app.inject(`/api/jobs/${jobId}`)).json();
  assert.equal(observed.telemetry.workerAlive, true);
  assert.match(observed.telemetry.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(observed.telemetry.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(observed.telemetry.statusUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.now() - Date.parse(observed.telemetry.startedAt) < 60_000);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project })).statusCode, 409);

  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '角色音色生成完成' }));
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project })).statusCode, 200);
  await app.close();
});

test('takes over a render request that remains active after its worker exits', async () => {
  const { root, project } = await fixture();
  const jobId = 'recoveredrender';
  const requestId = 'a'.repeat(32);
  const jobDir = path.join(root, 'runtime-output', 'product-jobs', jobId);
  const runtimeDir = path.join(root, 'runtime-output', 'render-runtime');
  await mkdir(jobDir, { recursive: true });
  await mkdir(path.join(runtimeDir, 'requests'), { recursive: true });
  await writeFile(path.join(jobDir, 'input.json'), JSON.stringify({ root, project_id: 'demo' }));
  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'rendering', fraction: 0.5, message: 'IndexTTS 正在生成 1/2' }));
  await writeFile(path.join(runtimeDir, 'state.json'), JSON.stringify({ protocol: 1, pid: process.pid, phase: 'busy', model_loaded: false, model_bytes: 1234, started_at: Date.now() / 1000, request_id: requestId }));
  await writeFile(path.join(runtimeDir, 'requests', `${requestId}.processing`), JSON.stringify({
    protocol: 1,
    request_id: requestId,
    input: path.join(jobDir, 'input.json'),
    result: path.join(jobDir, 'result.json'),
    status: path.join(jobDir, 'status.json'),
  }));

  const app = await buildApp({ repoRoot: root });
  assert.deepEqual((await app.inject('/api/active-job')).json(), {
    available: true,
    jobId,
    kind: 'render',
    projectId: 'demo',
    pid: process.pid,
    phase: 'rendering',
    fraction: 0.5,
    message: 'IndexTTS 正在生成 1/2',
  });
  const observed = (await app.inject(`/api/jobs/${jobId}`)).json();
  assert.equal(observed.telemetry.modelRuntime.engine, 'render');
  assert.equal(observed.telemetry.modelRuntime.processAlive, true);
  assert.equal(observed.telemetry.modelRuntime.modelLoaded, false);
  assert.equal(observed.telemetry.modelRuntime.modelBytes, 1234);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project })).statusCode, 409);
  const persisted = JSON.parse(await readFile(path.join(root, 'runtime-output', 'product-jobs', 'active-job.json'), 'utf8'));
  assert.deepEqual(persisted, { jobId, kind: 'render', projectId: 'demo', pid: process.pid });

  await writeFile(path.join(jobDir, 'status.json'), JSON.stringify({ phase: 'complete', fraction: 1, message: '完整声音作品已生成' }));
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
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

test('aligns inserted draft audio without clearing the following delivered fragment', () => {
  const manifest = [
    { order: 1, sourceText: '原有下一句', synthesisText: '原有下一句', audio: '/delivered-next.wav' },
  ];
  const draft = [
    { order: 1, sourceText: '插入句', synthesisText: '插入句', audio: '/draft-inserted.wav' },
  ];
  const projectSegments = [
    [1, '第 1 章', 'narrator', '旁白', 'ZH', '插入句', '插入句'],
    [2, '第 1 章', 'narrator', '旁白', 'ZH', '原有下一句', '原有下一句'],
  ];

  const aligned = reconcileFragmentsToProject(manifest, draft, projectSegments);

  assert.deepEqual(aligned.map(item => ({ order: item.order, audio: item.audio })), [
    { order: 1, audio: '/draft-inserted.wav' },
    { order: 2, audio: '/delivered-next.wav' },
  ]);
});

test('cancels an active worker, unlocks the project, and terminates dependent work', async () => {
  const { root, project } = await fixture();
  const children = [];
  const app = await buildApp({ repoRoot: root, launchWorker: () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 4101 + children.length;
    child.kill = () => {
      child.killed = true;
      queueMicrotask(() => child.emit('close', null));
      return true;
    };
    children.push(child);
    return child;
  } });

  const active = (await app.inject({ method: 'POST', url: '/api/projects/demo/analyze', payload: {} })).json();
  const dependent = (await app.inject({ method: 'POST', url: '/api/projects/demo/render', payload: {} })).json();
  const cancelled = await app.inject({ method: 'DELETE', url: `/api/jobs/${active.jobId}` });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.json().phase, 'cancelled');
  assert.equal(children[0].killed, true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await app.inject(`/api/jobs/${active.jobId}`)).json().phase, 'cancelled');
  const dependentStatus = (await app.inject(`/api/jobs/${dependent.jobId}`)).json();
  assert.equal(dependentStatus.phase, 'error');
  assert.match(dependentStatus.message, /依赖任务.*未成功/);
  assert.deepEqual((await app.inject('/api/active-job')).json(), { available: false });
  assert.equal((await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project })).statusCode, 200);
  await app.close();
});

test('cancels a waiting job without disturbing the active worker', async () => {
  const { root, project } = await fixture();
  const otherDir = path.join(root, 'outputs', 'novel-projects', 'other');
  await mkdir(otherDir, { recursive: true });
  await writeFile(path.join(otherDir, 'project.json'), JSON.stringify({ ...project, project_id: 'other' }));
  const children = [];
  const app = await buildApp({ repoRoot: root, launchWorker: () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
    children.push(child);
    return child;
  } });
  const active = (await app.inject({ method: 'POST', url: '/api/projects/demo/analyze', payload: {} })).json();
  const waiting = (await app.inject({ method: 'POST', url: '/api/projects/other/render', payload: {} })).json();
  assert.equal(children.length, 1);
  const cancelled = await app.inject({ method: 'DELETE', url: `/api/jobs/${waiting.jobId}` });
  assert.equal(cancelled.json().phase, 'cancelled');
  assert.equal((await app.inject(`/api/jobs/${waiting.jobId}`)).json().phase, 'cancelled');
  assert.equal((await app.inject('/api/active-job')).json().jobId, active.jobId);
  await app.inject({ method: 'DELETE', url: `/api/jobs/${active.jobId}` });
  await new Promise(resolve => setTimeout(resolve, 20));
  await app.close();
});

test('terminates only the runtime request owned by the cancelled audio job', async () => {
  const { root } = await fixture();
  const killedPids = [];
  let child;
  const app = await buildApp({
    repoRoot: root,
    killProcess: pid => { killedPids.push(pid); },
    launchWorker: () => {
      child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => { queueMicrotask(() => child.emit('close', null)); return true; };
      return child;
    },
  });
  const active = (await app.inject({ method: 'POST', url: '/api/projects/demo/render', payload: {} })).json();
  const runtimeDir = path.join(root, 'runtime-output', 'render-runtime');
  const requestsDir = path.join(runtimeDir, 'requests');
  await mkdir(requestsDir, { recursive: true });
  const requestId = 'a'.repeat(32);
  const statusPath = path.join(root, 'runtime-output', 'product-jobs', active.jobId, 'status.json');
  await writeFile(path.join(runtimeDir, 'state.json'), JSON.stringify({ phase: 'busy', pid: 9876, request_id: requestId }));
  await writeFile(path.join(requestsDir, `${requestId}.processing`), JSON.stringify({ status: statusPath }));

  const cancelled = await app.inject({ method: 'DELETE', url: `/api/jobs/${active.jobId}` });
  assert.equal(cancelled.json().runtimeTerminated, true);
  assert.deepEqual(killedPids, [9876]);
  await new Promise(resolve => setTimeout(resolve, 20));
  await app.close();
});

test('latest render keeps a shifted next fragment when a split fragment reuses its historical order', async () => {
  const { root, project } = await fixture();
  project.segments = [
    [15, '第 1 章', 'narrator', '旁白', 'ZH', '拆分出的后半句', '拆分出的后半句', '中性叙述', '平静', 0.5, '自然', 300],
    [16, '第 1 章', 'narrator', '旁白', 'ZH', '原有下一句', '原有下一句', '中性叙述', '平静', 0.5, '自然', 300],
  ];
  const projectDir = path.join(root, 'outputs', 'novel-projects', 'demo');
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
  const processDir = path.join(projectDir, 'process');
  await mkdir(processDir, { recursive: true });
  const splitKey = '1'.repeat(64);
  const shiftedNextKey = '2'.repeat(64);
  await writeFile(path.join(processDir, 'segment-fragments.json'), JSON.stringify({ version: 1, fragments: {
    [splitKey]: { order: 15, speaker_name: '旁白', source_text: '拆分出的后半句', text: '拆分出的后半句' },
    [shiftedNextKey]: { order: 15, speaker_name: '旁白', source_text: '原有下一句', text: '原有下一句' },
  } }));
  const app = await buildApp({ repoRoot: root });

  const latest = (await app.inject('/api/projects/demo/latest-render')).json();

  assert.deepEqual(latest.fragments.map(item => ({ order: item.order, sourceText: item.sourceText, audio: item.audio })), [
    { order: 15, sourceText: '拆分出的后半句', audio: `/api/projects/demo/cached-fragments/${splitKey}` },
    { order: 16, sourceText: '原有下一句', audio: `/api/projects/demo/cached-fragments/${shiftedNextKey}` },
  ]);
  await app.close();
});

test('consumes repeated-text audio fragments once and keeps their current orders', () => {
  const manifest = [
    { order: 1, sourceText: '重复句', synthesisText: '重复句', audio: '/delivered-first.wav' },
    { order: 2, sourceText: '重复句', synthesisText: '重复句', audio: '/delivered-second.wav' },
  ];
  const draft = [
    { order: 2, sourceText: '重复句', synthesisText: '重复句', audio: '/draft-second.wav' },
  ];
  const projectSegments = [
    [1, '第 1 章', 'narrator', '旁白', 'ZH', '重复句', '重复句'],
    [2, '第 1 章', 'narrator', '旁白', 'ZH', '重复句', '重复句'],
  ];

  const aligned = reconcileFragmentsToProject(manifest, draft, projectSegments);

  assert.deepEqual(aligned.map(item => ({ order: item.order, audio: item.audio })), [
    { order: 1, audio: '/delivered-first.wav' },
    { order: 2, audio: '/draft-second.wav' },
  ]);
});
