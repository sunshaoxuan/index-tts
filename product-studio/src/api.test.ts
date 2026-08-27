import assert from 'node:assert/strict';
import test from 'node:test';
import { parseApiResponse } from './api.ts';

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
