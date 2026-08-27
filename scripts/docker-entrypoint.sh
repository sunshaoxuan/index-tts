#!/usr/bin/env sh
set -eu

mkdir -p /app/checkpoints /app/outputs /app/runtime-output /app/artifacts

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const runtimeRoot = '/app/runtime-output';
const jobsRoot = path.join(runtimeRoot, 'product-jobs');
const activePath = path.join(jobsRoot, 'active-job.json');
try {
  const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  const statusPath = path.join(runtimeRoot, 'product-jobs', String(active.jobId || ''), 'status.json');
  if (active.jobId && fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, JSON.stringify({
      phase: 'error',
      fraction: 1,
      message: '容器重新启动，中断了上一次运行中的任务，请重新执行该任务',
    }));
  }
  fs.rmSync(activePath, { force: true });
} catch {}

try {
  for (const entry of fs.readdirSync(jobsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statusPath = path.join(jobsRoot, entry.name, 'status.json');
    try {
      const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
      if (!['complete', 'error'].includes(status.phase)) {
        fs.writeFileSync(statusPath, JSON.stringify({
          phase: 'error',
          fraction: 1,
          message: '容器重新启动，中断了上一次未完成的任务，请重新执行该任务',
        }));
      }
    } catch {}
  }
} catch {}

for (const name of ['voice-design-runtime', 'render-runtime']) {
  const dir = path.join(runtimeRoot, name);
  for (const file of ['state.json', 'stop.request', 'release.request', 'release-response.json']) {
    fs.rmSync(path.join(dir, file), { force: true });
  }
  fs.rmSync(path.join(dir, 'requests'), { recursive: true, force: true });
}
NODE

exec "$@"
