import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptImagePrompt,
  compatibleImageGenerationRequest,
  compatibleServiceError,
  extractCompatibleImageItem,
  imageModelCandidates,
  imageModelFamily,
  isImageCooldownError,
  runWithImageModelFallback,
} from './image-model-routing.mjs';

const settings = {
  image_model: 'gpt-image-2',
  image_fallback_model: 'gemini-3-pro-image',
  image_fallback_enabled: true,
};

test('classifies Gemini and GPT image models and applies distinct prompt profiles', () => {
  assert.equal(imageModelFamily('gemini-3-pro-image'), 'gemini_image');
  assert.equal(imageModelFamily('gpt-image-2'), 'gpt_image');
  assert.match(adaptImagePrompt('镜头规格', 'gemini-3-pro-image'), /Gemini 图像执行说明/);
  assert.match(adaptImagePrompt('镜头规格', 'gpt-image-2'), /GPT Image 执行说明/);
  assert.match(adaptImagePrompt('角色规格', 'gpt-image-2', 'portrait'), /单人角色设定图/);
});

test('routes Gemini image generation through Chat Completions and GPT Image through Images API', () => {
  const gemini = compatibleImageGenerationRequest('gemini-3.1-flash-image', '角色规格', '1:1');
  assert.equal(gemini.route, '/chat/completions');
  assert.equal(gemini.payload.messages[0].content, '角色规格');
  assert.deepEqual(gemini.payload.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } });

  const gpt = compatibleImageGenerationRequest('gpt-image-2', '镜头规格', '16:9');
  assert.equal(gpt.route, '/images/generations');
  assert.equal(gpt.payload.size, '1536x1024');
  assert.equal(gpt.payload.response_format, 'b64_json');
});

test('extracts images from Images API, Gemini inline data, and Chat Completions', () => {
  assert.deepEqual(extractCompatibleImageItem({ data: [{ b64_json: 'aW1hZ2U=' }] }), { b64_json: 'aW1hZ2U=' });
  assert.deepEqual(extractCompatibleImageItem({ candidates: [{ content: { parts: [{ text: '说明' }, { inlineData: { data: 'aW1hZ2U=' } }] } }] }), { inlineData: { data: 'aW1hZ2U=' } });
  assert.deepEqual(extractCompatibleImageItem({ choices: [{ message: { images: [{ image_url: { url: 'https://cdn.example/image.png' } }] } }] }), { url: 'https://cdn.example/image.png' });
  assert.deepEqual(extractCompatibleImageItem({ choices: [{ message: { content: '完成\n![image](data:image/png;base64,aW1hZ2U=)' } }] }), { url: 'data:image/png;base64,aW1hZ2U=' });
  assert.throws(() => extractCompatibleImageItem({ choices: [{ message: { content: '只有文字' } }] }), /没有返回图像数据/);
});

test('limits requested models to the configured primary and complement', () => {
  assert.deepEqual(imageModelCandidates(settings, 'gpt-image-2', true), ['gpt-image-2', 'gemini-3-pro-image']);
  assert.deepEqual(imageModelCandidates(settings, 'gemini-3-pro-image', true), ['gemini-3-pro-image', 'gpt-image-2']);
  assert.deepEqual(imageModelCandidates(settings, 'gpt-image-2', false), ['gpt-image-2']);
  assert.throws(() => imageModelCandidates(settings, 'unknown-image', true), /未配置为主模型或互补模型/);
});

test('preserves compatible response status and cooldown duration', () => {
  const error = compatibleServiceError({ status: 429, headers: new Headers({ 'retry-after': '12' }) }, { error: { message: 'RESOURCE_EXHAUSTED', code: 'quota' } });
  assert.equal(error.statusCode, 429);
  assert.equal(error.retryAfterMs, 12_000);
  assert.equal(isImageCooldownError(error), true);
  assert.equal(isImageCooldownError(Object.assign(new Error('invalid reference image'), { statusCode: 400 })), false);
});

test('uses the complement after a retryable primary cooldown error', async () => {
  const calls = [];
  const cooldowns = new Map();
  const result = await runWithImageModelFallback({
    settings,
    requestedModel: 'gpt-image-2',
    allowFallback: true,
    cooldowns,
    now: () => 1_000,
    execute: async model => {
      calls.push(model);
      if (model === 'gpt-image-2') throw Object.assign(new Error('rate limit'), { statusCode: 429, retryAfterMs: 30_000 });
      return { image: 'ok' };
    },
  });
  assert.deepEqual(calls, ['gpt-image-2', 'gemini-3-pro-image']);
  assert.equal(result.actualModel, 'gemini-3-pro-image');
  assert.equal(result.fallbackUsed, true);
  assert.match(result.fallbackReason, /gpt-image-2 rate limit/);
  assert.equal(cooldowns.get('gpt-image-2'), 31_000);
});

test('skips a model already cooling and rejects non-cooldown failures', async () => {
  const calls = [];
  const cooled = await runWithImageModelFallback({
    settings,
    requestedModel: 'gpt-image-2',
    allowFallback: true,
    cooldowns: new Map([['gpt-image-2', 50_000]]),
    now: () => 1_000,
    execute: async model => { calls.push(model); return model; },
  });
  assert.deepEqual(calls, ['gemini-3-pro-image']);
  assert.equal(cooled.fallbackUsed, true);
  assert.match(cooled.fallbackReason, /仍在冷却/);

  await assert.rejects(runWithImageModelFallback({
    settings,
    requestedModel: 'gpt-image-2',
    allowFallback: true,
    cooldowns: new Map(),
    execute: async () => { throw Object.assign(new Error('Images Edits unsupported'), { statusCode: 400 }); },
  }), /Images Edits unsupported/);
});
