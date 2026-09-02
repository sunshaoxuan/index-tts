import assert from 'node:assert/strict';
import test from 'node:test';
import { api, parseApiResponse, projectSavePayload } from './api.ts';

test('reports an actionable service error for an HTML API response', async () => {
  const response = new Response('<!DOCTYPE html><title>Bad Gateway</title>', {
    status: 502,
    headers: { 'Content-Type': 'text/html' },
  });

  await assert.rejects(parseApiResponse(response), error => {
    assert.match(String((error as Error).message), /非 JSON 响应.*HTTP 502.*正在重启/);
    assert.doesNotMatch(String((error as Error).message), /Unexpected token|DOCTYPE/);
    return true;
  });
});

test('preserves a JSON API error message', async () => {
  const response = new Response(JSON.stringify({ error: 'Worker 启动失败：ENOENT' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(parseApiResponse(response), /Worker 启动失败：ENOENT/);
});

test('omits server-owned director snapshots from project save payloads', () => {
  const project = {
    project_id: 'large-project',
    title: '大型工程',
    director_history: [{ operation_id: 'history-1', snapshot: { source_text: 'x'.repeat(30 * 1024 * 1024) } }],
    director_memory: { source_text: 'memory' },
  } as unknown as Parameters<typeof projectSavePayload>[0];

  const payload = projectSavePayload(project);

  assert.equal('director_history' in payload, false);
  assert.equal('director_memory' in payload, false);
  assert.equal(payload.project_id, 'large-project');
  assert.equal(project.director_history?.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') < 1024);
});

test('forwards an abort signal to long-running AI requests', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let observedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    observedSignal = init?.signal;
    return new Response(JSON.stringify({ profile: '扩写结果', model: 'fixture' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await api.expandCharacterProfile('demo', 'narrator', { name: '旁白', profile: '现有小传', gender: 'unspecified', age: 35 }, controller.signal);
    assert.equal(observedSignal, controller.signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
