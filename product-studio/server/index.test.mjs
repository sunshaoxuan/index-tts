import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { buildApp, wavDurationSeconds } from './index.mjs';

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

test('serves presets and project data', async () => {
  const { root } = await fixture();
  const app = await buildApp({ repoRoot: root });
  const health = await app.inject('/api/health');
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().productVersion, '1.0.0');
  assert.deepEqual(health.json().voiceModel, { processAlive: false, modelLoaded: false, phase: 'cold' });
  const presetResponse = await app.inject('/api/presets');
  assert.ok(presetResponse.json().emotions.includes('平静'));
  assert.equal(presetResponse.json().voiceStylePrompts['低沉厚实'], '低沉厚实，声音有支撑，气息稳定');
  assert.equal(presetResponse.json().rhythmPrompts['沉稳舒缓'], '沉稳舒缓，重音清晰，短语间自然停连');
  assert.equal((await app.inject('/api/projects/demo')).json().title, '测试');
  await app.close();
});

test('returns delivery captions with real WAV duration and manifest pauses', async () => {
  const { root } = await fixture();
  const renderDir = path.join(root, 'outputs', 'novel-projects', 'demo', 'renders', 'render-captioned');
  const segmentsDir = path.join(renderDir, 'segments');
  await mkdir(segmentsDir, { recursive: true });
  await writeFile(path.join(renderDir, 'full-audio.wav'), pcmWav(3.75));
  await writeFile(path.join(segmentsDir, '0001.wav'), pcmWav(1.25));
  await writeFile(path.join(segmentsDir, '0002.wav'), pcmWav(2));
  await writeFile(path.join(renderDir, 'director-manifest.json'), JSON.stringify({ segments: [
    { order: 1, speaker_name: '旁白', source_text: '第一句。', text: '第一句。', pause_after_ms: 500, cache_key: 'a', audio: 'segments/0001.wav' },
    { order: 2, speaker_name: '笹垣润三', source_text: '第二句。', text: '第二句。', pause_after_ms: 0, cache_key: 'b', audio: 'segments/0002.wav' },
  ] }));

  assert.equal(await wavDurationSeconds(path.join(segmentsDir, '0001.wav')), 1.25);
  const app = await buildApp({ repoRoot: root });
  const latest = (await app.inject('/api/projects/demo/latest-render')).json();
  assert.deepEqual(latest.captions, [
    { order: 1, speakerName: '旁白', text: '第一句。', durationSeconds: 1.25, pauseAfterMs: 500 },
    { order: 2, speakerName: '笹垣润三', text: '第二句。', durationSeconds: 2, pauseAfterMs: 0 },
  ]);
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
  assert.deepEqual(saved.json(), { endpoint: 'http://127.0.0.1:49530/v1', textModel: 'gemini-pro', directorProvider: 'ollama', directorModel: 'qwen3:8b', ollamaEndpoint: 'http://127.0.0.1:11434', directorMaxChunkChars: 1400, imageModel: 'gpt-image', instanceId: '', textApi: 'chat_completions', allowInsecureHttp: false, transportRisk: false, hasApiKey: true });
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
    calls.push({ url: String(url), authorization: options?.headers?.Authorization });
    return new Response(JSON.stringify({ data: [{ id: 'gemini-2.5-flash' }, { id: 'gpt-image-1' }, { id: 'gemini-2.5-flash' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const app = await buildApp({ repoRoot: root, remoteFetch });
  await app.inject({ method: 'PUT', url: '/api/settings/ai-media', payload: { endpoint: 'http://ai.example/v1', apiKey: 'secret-key', textModel: 'old-model', imageModel: 'old-image', allowInsecureHttp: true } });
  const tested = await app.inject({ method: 'POST', url: '/api/settings/ai-media/test', payload: { endpoint: 'http://ai.example/v1' } });
  assert.equal(tested.statusCode, 200);
  assert.deepEqual(tested.json(), { ok: true, endpoint: 'http://ai.example/v1', instanceId: '', models: ['gemini-2.5-flash', 'gpt-image-1'], modelCount: 2 });
  assert.deepEqual(calls, [{ url: 'http://ai.example/v1/models', authorization: 'Bearer secret-key' }]);
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
  assert.equal(input.config.staged_analysis, true);
  assert.equal(JSON.stringify(input).includes('director-secret'), false);
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
  project.character_assets.narrator.audition_text = '这是旁白独立使用的试听文本。';
  project.character_assets.narrator.voice_candidates = [{ voice_id: 'voice-verified', seed: 77, median_pitch_hz: 218.5, selected: true, gender_verified: true }];
  const saved = await app.inject({ method: 'PUT', url: '/api/projects/demo', payload: project });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().character_assets.narrator.voice_traits.roughness, 83);
  assert.equal(saved.json().character_assets.narrator.voice_generation.temperature, 1.25);
  assert.equal(saved.json().character_assets.narrator.voice_generation.candidate_count, 5);
  assert.equal(saved.json().character_assets.narrator.audition_text, '这是旁白独立使用的试听文本。');
  assert.deepEqual(saved.json().character_assets.narrator.voice_candidates, [{ voice_id: 'voice-verified', seed: 77, median_pitch_hz: 218.5, selected: true, gender_verified: true }]);
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
  const lockedDelete = await app.inject({ method: 'DELETE', url: '/api/projects/demo' });
  assert.equal(lockedDelete.statusCode, 409);
  assert.match(lockedDelete.json().error, /工程版本已被任务.*锁定/);
  await access(path.join(root, 'outputs', 'novel-projects', 'demo', 'project.json'));
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
  await writeFile(path.join(runtimeDir, 'state.json'), JSON.stringify({ protocol: 1, pid: process.pid, phase: 'busy', request_id: requestId }));
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
