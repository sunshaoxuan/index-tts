const DEFAULT_COOLDOWN_MS = 60_000;

export function imageModelFamily(model) {
  const id = String(model || '').trim().toLowerCase();
  if (id.includes('gemini') && id.includes('image')) return 'gemini_image';
  if (id.includes('gpt') && id.includes('image')) return 'gpt_image';
  return 'compatible_image';
}

export function imagePromptProfile(model) {
  const family = imageModelFamily(model);
  return family === 'gemini_image' ? 'gemini_visual_spec_v1' : family === 'gpt_image' ? 'gpt_image_visual_spec_v1' : 'compatible_visual_spec_v1';
}

export function adaptImagePrompt(basePrompt, model, purpose = 'storyboard') {
  const family = imageModelFamily(model);
  const purposeLine = purpose === 'portrait'
    ? '任务类型：单人角色设定图。优先保持面部结构、年龄感、发型、服装逻辑和可复用身份特征。'
    : '任务类型：单张 16:9 视频分镜关键帧。优先保持镜头构图、人物身份、空间连续性和统一画面风格。';
  const familyLine = family === 'gemini_image'
    ? 'Gemini 图像执行说明：直接返回一张完成图；把下方中文规格作为同一画面的完整约束，先锁定主体与空间关系，再统一材质、光线和综合色彩。'
    : family === 'gpt_image'
      ? 'GPT Image 执行说明：直接生成一张完成图；严格遵循下方主体、构图、身份参考和风格规格，保持自然细节与清晰空间层次。'
      : '兼容图像模型执行说明：直接返回一张完成图；完整遵循下方主体、构图、身份参考和风格规格。';
  return [familyLine, purposeLine, '跨模型统一约束：不得改变人物身份，不得增加文字、边框、多格布局或与原文无关的主体。', String(basePrompt || '').trim()].filter(Boolean).join('\n');
}

export function compatibleImageGenerationRequest(model, prompt, aspectRatio = '1:1') {
  const family = imageModelFamily(model);
  if (family === 'gemini_image') {
    return {
      route: '/chat/completions',
      payload: {
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio, imageSize: '1K' },
        },
      },
    };
  }
  return {
    route: '/images/generations',
    payload: {
      model,
      prompt,
      size: aspectRatio === '1:1' ? '1024x1024' : '1536x1024',
      n: 1,
      response_format: 'b64_json',
    },
  };
}

function imageUrlItem(value) {
  const url = String(value || '').trim();
  return url ? { url } : undefined;
}

export function extractCompatibleImageItem(body) {
  const direct = body?.data?.[0]
    || body?.candidates?.[0]?.content?.parts?.find(part => part?.inlineData || part?.inline_data);
  if (direct) return direct;

  const message = body?.choices?.[0]?.message;
  const image = Array.isArray(message?.images) ? message.images[0] : undefined;
  const imageUrl = image?.image_url?.url || image?.image_url || image?.url;
  if (imageUrl) return imageUrlItem(imageUrl);

  if (Array.isArray(message?.content)) {
    const part = message.content.find(item => item?.inlineData || item?.inline_data || item?.b64_json || item?.image_url || item?.url);
    if (part?.image_url) return imageUrlItem(part.image_url?.url || part.image_url);
    if (part?.url) return imageUrlItem(part.url);
    if (part) return part;
  }

  const content = typeof message?.content === 'string' ? message.content : '';
  const markdown = content.match(/!\[[^\]]*\]\((data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/_=-]+|https?:\/\/[^)\s]+)\)/iu);
  if (markdown) return imageUrlItem(markdown[1]);
  const dataUrl = content.match(/data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/_=-]+/iu);
  if (dataUrl) return imageUrlItem(dataUrl[0]);
  throw new Error('兼容服务没有返回图像数据');
}

function retryAfterMs(response, body) {
  const headerValue = response?.headers?.get?.('retry-after');
  if (headerValue && /^\d+(?:\.\d+)?$/u.test(headerValue)) return Math.max(1_000, Number(headerValue) * 1_000);
  const bodyValue = Number(body?.error?.retry_after ?? body?.retry_after ?? body?.retryAfterSeconds);
  return Number.isFinite(bodyValue) && bodyValue > 0 ? Math.max(1_000, bodyValue * 1_000) : DEFAULT_COOLDOWN_MS;
}

export function compatibleServiceError(response, body, fallbackMessage = '兼容服务请求失败') {
  const detail = String(body?.error?.message || body?.message || `${fallbackMessage} ${response?.status || ''}`).trim();
  const error = new Error(detail);
  error.statusCode = Number(response?.status) || 400;
  error.retryAfterMs = retryAfterMs(response, body);
  error.serviceCode = String(body?.error?.code || body?.code || '').trim();
  return error;
}

export function isImageCooldownError(error) {
  if (error?.name === 'AbortError') return false;
  if ([429, 503].includes(Number(error?.statusCode))) return true;
  const detail = `${String(error?.serviceCode || '')} ${String(error?.message || '')}`.toLowerCase();
  return /resource[_\s-]?exhausted|rate[_\s-]?limit|too many requests|quota|cooldown|temporar(?:y|ily) unavailable|overloaded|冷却|限流|配额|暂时不可用/u.test(detail);
}

export function imageModelCandidates(settings, requestedModel, allowFallback) {
  const primary = String(settings?.image_model || '').trim();
  const complement = String(settings?.image_fallback_model || '').trim();
  const requested = String(requestedModel || primary).trim();
  const configured = new Set([primary, complement].filter(Boolean));
  if (!requested) throw new Error('请先配置图像模型');
  if (!configured.has(requested)) throw new Error(`图像模型 ${requested} 未配置为主模型或互补模型`);
  const fallbackEnabled = Boolean(allowFallback && settings?.image_fallback_enabled && complement && complement !== primary);
  const other = requested === primary ? complement : primary;
  return [requested, ...(fallbackEnabled && other ? [other] : [])];
}

export async function runWithImageModelFallback({ settings, requestedModel, allowFallback, cooldowns, execute, now = () => Date.now() }) {
  const candidates = imageModelCandidates(settings, requestedModel, allowFallback);
  const requested = candidates[0];
  const skipped = [];
  let fallbackReason = '';
  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const cooldownUntil = Number(cooldowns.get(model) || 0);
    if (cooldownUntil > now()) {
      const remainingSeconds = Math.max(1, Math.ceil((cooldownUntil - now()) / 1_000));
      const reason = `${model} 仍在冷却，剩余约 ${remainingSeconds} 秒`;
      skipped.push(reason);
      fallbackReason ||= reason;
      continue;
    }
    try {
      const value = await execute(model);
      cooldowns.delete(model);
      return {
        value,
        requestedModel: requested,
        actualModel: model,
        fallbackUsed: model !== requested,
        fallbackReason: model !== requested ? fallbackReason : '',
        promptProfile: imagePromptProfile(model),
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (!isImageCooldownError(error)) throw error;
      const duration = Math.max(1_000, Number(error?.retryAfterMs) || DEFAULT_COOLDOWN_MS);
      cooldowns.set(model, now() + duration);
      const reason = `${model} ${error.message}`;
      fallbackReason ||= reason;
      if (index === candidates.length - 1) {
        error.message = `${reason}${skipped.length ? `；${skipped.join('；')}` : ''}`;
        throw error;
      }
    }
  }
  const error = new Error(`可用图像模型仍在冷却：${skipped.join('；')}`);
  error.statusCode = 429;
  throw error;
}
