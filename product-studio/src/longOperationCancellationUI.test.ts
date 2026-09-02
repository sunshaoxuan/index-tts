import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

test('exposes cancel controls for queued work, audio, AI, images, and project loading', () => {
  for (const label of [
    '取消当前任务',
    '取消全量关键帧',
    '取消这一张',
    '取消扩写',
    '取消形象生成',
    '取消全文分析服务测试',
    '取消兼容 Endpoint 测试',
    '取消切换',
  ]) assert.match(app, new RegExp(label));
  assert.match(app, /api\.cancelJob\(current\.id\)/);
  assert.match(app, /keyframeAbortRef\.current\?\.abort\(\)/);
});
