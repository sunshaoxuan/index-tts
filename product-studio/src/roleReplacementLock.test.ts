import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

test('locks the complete role replacement workflow until project persistence finishes', () => {
  assert.match(app, /const \[roleReplacementSaving, setRoleReplacementSaving\] = useState\(false\)/);
  assert.match(app, /roleReplacementSavingRef\.current = true;[\s\S]*setRoleReplacementSaving\(true\);[\s\S]*await api\.save\(result\.project\)/);
  assert.match(app, /finally \{[\s\S]*roleReplacementSavingRef\.current = false;[\s\S]*setRoleReplacementSaving\(false\)/);
  assert.match(app, /<Spin fullscreen spinning=\{roleReplacementSaving\}[\s\S]*正在替换角色并保存工程，请勿关闭页面/);
  assert.match(app, /confirmLoading=\{roleReplacementSaving\}/);
  assert.match(app, /closable=\{!roleReplacementSaving\}/);
  assert.match(app, /keyboard=\{!roleReplacementSaving\}/);
  assert.match(app, /maskClosable=\{!roleReplacementSaving\}/);
  assert.match(app, /cancelButtonProps=\{\{ disabled: roleReplacementSaving \}\}/);
  assert.match(app, /disabled=\{jobRunning \|\| roleReplacementSaving\}/);
});

test('keeps the replacement dialog open with a retryable error when persistence fails', () => {
  assert.match(app, /角色替换保存失败：\$\{\(error as Error\)\.message\}。源角色仍保留，请重试/);
  const closeAfterSave = app.indexOf('setRoleReplacementSourceId(undefined);', app.indexOf('const applyRoleReplacement'));
  const saveAwait = app.indexOf('await api.save(result.project)', app.indexOf('const applyRoleReplacement'));
  assert.ok(saveAwait >= 0 && closeAfterSave > saveAwait);
});
