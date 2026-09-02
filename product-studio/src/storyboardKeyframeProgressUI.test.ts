import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('generates all keyframes sequentially after one complete preflight', () => {
  assert.match(app, /preflightStoryboardShotKeyframes\(project\.project_id, shots, keyframeStyle/);
  assert.match(app, /runKeyframeQueue\(items, 'all', storyboardStyle/);
  assert.match(app, /storyboard-keyframe-progress-count[^\n]*\{storyboardKeyframeProgress\.completed\} \/ \{storyboardKeyframeProgress\.total\}/);
  assert.match(app, /applyGeneratedKeyframe\(item\.sceneId, item\.shotId, result\)/);
});

test('shows live progress, current shot, timing, failure recovery and lock status', () => {
  assert.match(app, /aria-label="关键帧生成进度"/);
  assert.match(app, /当前镜头：/);
  assert.match(app, /预计剩余/);
  assert.match(app, /等待图像服务响应/);
  assert.match(app, /关键帧生成已取消/);
  assert.match(app, /已完成的 \$\{storyboardKeyframeProgress\.completed\} 张图片已保留/);
  assert.match(app, /分镜编辑、工程切换、保存和其他生成操作已锁定/);
  assert.match(app, /window\.setInterval\(\(\) => setStoryboardKeyframeProgressNow\(Date\.now\(\)\), 1000\)/);
});

test('shows the exact source range and AI evidence used for each shot note', () => {
  assert.match(app, /const shotSource = String\(shot\.source_text \|\| shot\.source_excerpt/);
  assert.match(app, /镜头对应原文/);
  assert.match(app, /AI 取景证据：\{shotEvidence\}/);
  assert.match(styles, /\.storyboard-shot-source span\s*\{[^}]*overflow-wrap/s);
});

test('locks every storyboard mutation surface while keyframe generation is active', () => {
  assert.match(app, /const projectLocked = jobRunning \|\| keyframeGenerationActive/);
  assert.match(app, /disabled=\{projectLocked \|\| projectSwitch\.phase === 'loading'\}/);
  assert.match(app, /disabled=\{projectLocked \|\| !dirty\}/);
  assert.match(app, /<Checkbox disabled=\{projectLocked\}/);
  assert.match(app, /镜头画面小记<\/Text><Input\.TextArea disabled=\{projectLocked\}/);
  assert.match(app, /关键帧风格<\/Text><Select disabled=\{projectLocked\}/);
  assert.match(app, /AI 场景小记<\/Text>[\s\S]*?<Input\.TextArea disabled=\{projectLocked\}/);
  assert.match(app, /okButtonProps=\{\{ disabled: projectLocked \}\} cancelButtonProps=\{\{ disabled: projectLocked \}\}/);
  assert.match(app, /storyboard-workspace-card\$\{keyframeGenerationActive \? ' is-keyframe-locked'/);
  assert.match(app, /workspace-tabs\$\{keyframeGenerationActive \? ' is-keyframe-locked'/);
});

test('styles a responsive and visually distinct progress panel', () => {
  assert.match(styles, /\.storyboard-keyframe-progress\s*\{[^}]*display:\s*grid;[^}]*border-left:\s*4px solid var\(--orange\);/s);
  assert.match(styles, /\.storyboard-keyframe-progress-detail\s*\{[^}]*grid-template-columns:/s);
  assert.match(styles, /\.storyboard-workspace-card\.is-keyframe-locked/s);
  assert.match(styles, /\.workspace-tabs\.is-keyframe-locked/s);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.storyboard-keyframe-progress-detail\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
});

test('stacks scene titles and metadata on narrow screens', () => {
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.storyboard-scene-card > \.ant-card-head > \.ant-card-head-wrapper\s*\{[^}]*display:\s*grid;[^}]*gap:\s*10px;/s);
  assert.match(styles, /\.storyboard-scene-card > \.ant-card-head \.ant-card-head-title,[\s\S]*?\.storyboard-scene-card > \.ant-card-head \.ant-card-extra\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.storyboard-scene-card > \.ant-card-head \.ant-card-extra \.ant-space\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*flex-start;/s);
});
