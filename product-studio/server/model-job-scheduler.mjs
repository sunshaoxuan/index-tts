function normalizedPart(value, fallback) {
  return String(value || fallback).trim().toLowerCase().replace(/\s+/gu, ' ');
}

export function jobModelKey(kind, config = {}) {
  if (kind === 'render' || kind === 'standardize') return 'indextts:index-tts-2.5';
  if (kind === 'voice') return 'voice-design:qwen3-tts-1.7b';
  if (kind === 'analyze' || kind === 'storyboard') {
    const provider = normalizedPart(config.provider, 'ollama');
    const endpoint = normalizedPart(config.base_url, 'http://127.0.0.1:11434').replace(/\/+$/u, '');
    const model = normalizedPart(config.model, 'qwen3:14b');
    return `director:${provider}:${endpoint}:${model}`;
  }
  throw new Error(`不支持的任务类型：${kind}`);
}

function compareJobs(left, right) {
  const timeOrder = String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
  return timeOrder || String(left.jobId).localeCompare(String(right.jobId));
}

export function classifyPendingJobs(jobs, statusById, preferredModelKey = '') {
  const failed = [];
  const ready = [];
  for (const job of jobs) {
    const dependencies = Array.isArray(job.dependencies) ? job.dependencies : [];
    const failedDependency = dependencies.find(jobId => ['error', 'cancelled', 'missing'].includes(statusById[jobId]));
    if (failedDependency) {
      failed.push({ job, failedDependency, dependencyStatus: statusById[failedDependency] });
      continue;
    }
    if (dependencies.every(jobId => statusById[jobId] === 'complete')) ready.push(job);
  }
  ready.sort(compareJobs);
  const sameModel = preferredModelKey ? ready.find(job => job.modelKey === preferredModelKey) : undefined;
  return { next: sameModel || ready[0], failed };
}
