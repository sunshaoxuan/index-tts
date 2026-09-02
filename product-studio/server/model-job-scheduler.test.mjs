import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPendingJobs, jobModelKey } from './model-job-scheduler.mjs';

test('builds stable model keys for each background generation kind', () => {
  assert.equal(jobModelKey('render'), 'indextts:index-tts-2.5');
  assert.equal(jobModelKey('voice'), 'voice-design:qwen3-tts-1.7b');
  assert.equal(jobModelKey('analyze', { provider: 'OLLAMA', base_url: 'http://127.0.0.1:11434/', model: 'Qwen3:14B' }), 'director:ollama:http://127.0.0.1:11434:qwen3:14b');
  assert.equal(jobModelKey('storyboard', { provider: 'OLLAMA', base_url: 'http://127.0.0.1:11434/', model: 'Qwen3:14B' }), 'director:ollama:http://127.0.0.1:11434:qwen3:14b');
});

test('keeps blocked jobs behind their dependencies', () => {
  const blocked = { jobId: 'blocked', modelKey: 'indextts:index-tts-2.5', dependencies: ['analysis'], createdAt: '2026-08-30T00:00:00.000Z' };
  const independent = { jobId: 'independent', modelKey: 'voice-design:qwen3-tts-1.7b', dependencies: [], createdAt: '2026-08-30T00:00:01.000Z' };
  assert.equal(classifyPendingJobs([blocked, independent], { analysis: 'running' }, 'indextts:index-tts-2.5').next.jobId, 'independent');
});

test('finishes ready work for the resident model before switching models', () => {
  const olderOtherModel = { jobId: 'older', modelKey: 'voice-design:qwen3-tts-1.7b', dependencies: [], createdAt: '2026-08-30T00:00:00.000Z' };
  const residentModel = { jobId: 'resident', modelKey: 'indextts:index-tts-2.5', dependencies: [], createdAt: '2026-08-30T00:00:01.000Z' };
  assert.equal(classifyPendingJobs([olderOtherModel, residentModel], {}, 'indextts:index-tts-2.5').next.jobId, 'resident');
});

test('reports a failed dependency instead of releasing its dependent job', () => {
  const dependent = { jobId: 'dependent', modelKey: 'indextts:index-tts-2.5', dependencies: ['voice'], createdAt: '2026-08-30T00:00:00.000Z' };
  const classified = classifyPendingJobs([dependent], { voice: 'error' });
  assert.equal(classified.next, undefined);
  assert.equal(classified.failed[0].failedDependency, 'voice');
});

test('treats a cancelled dependency as terminal failure', () => {
  const dependent = { jobId: 'dependent', modelKey: 'indextts:index-tts-2.5', dependencies: ['analysis'], createdAt: '2026-08-30T00:00:00.000Z' };
  const classified = classifyPendingJobs([dependent], { analysis: 'cancelled' });
  assert.equal(classified.next, undefined);
  assert.equal(classified.failed[0].dependencyStatus, 'cancelled');
});

test('reports a missing dependency record instead of waiting forever', () => {
  const dependent = { jobId: 'dependent', modelKey: 'indextts:index-tts-2.5', dependencies: ['missing-job'], createdAt: '2026-08-30T00:00:00.000Z' };
  const classified = classifyPendingJobs([dependent], { 'missing-job': 'missing' });
  assert.equal(classified.next, undefined);
  assert.equal(classified.failed[0].dependencyStatus, 'missing');
});
