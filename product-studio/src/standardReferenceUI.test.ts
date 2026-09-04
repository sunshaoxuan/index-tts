import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('offers a standard reference workflow anchored to the original upload', () => {
  assert.match(app, /生成标准角色参考样本/);
  assert.match(app, /原始上传样本/);
  assert.match(app, /generateStandardReference/);
  assert.match(app, /api\.generateStandardReference/);
  assert.match(app, /生成三版标准样本/);
  assert.match(app, /结果不会自动成为下一轮参考源/);
});

test('shows quality evidence only for a complete set of three full-gate candidates', () => {
  assert.match(app, /candidate\.speaker_similarity\.toFixed\(3\)/);
  assert.match(app, /candidate\.echo_similarity\.toFixed\(3\)/);
  assert.match(app, /completeStandardReferenceCandidates\(roleAssetDraft\.standard_reference\.candidates\)\.length === 3/);
  assert.match(app, /当前结果只有.*个候选通过全部门禁，未形成完整三版，请重新生成标准样本/);
  assert.doesNotMatch(app, />未通过门禁</);
  assert.match(app, /api\.adoptStandardReference/);
});

test('keeps generation cancellable and supports restoring the immutable original sample', () => {
  assert.match(app, /取消标准样本生成/);
  assert.match(app, /onClick=\{cancelActiveJob\}/);
  assert.match(app, /恢复原始样本/);
  assert.match(app, /api\.restoreOriginalReference/);
  assert.match(app, /closable=\{!projectLocked\}/);
  assert.match(app, /active\.kind === 'standardize' && active\.roleId/);
  assert.match(app, /standardizingRoleIdRef\.current = active\.roleId/);
});

test('keeps standard reference controls usable on narrow screens', () => {
  assert.match(styles, /\.standard-reference-controls[^}]*grid-template-columns/);
  assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.standard-reference-controls, \.standard-reference-candidate[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});
