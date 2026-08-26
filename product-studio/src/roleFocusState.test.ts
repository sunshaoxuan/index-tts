import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeActiveRoleId, roleRowClassName } from './roleFocusState.ts';
import type { RoleRow } from './types.ts';

const roles: RoleRow[] = [
  ['narrator', '旁白', 'narrator', '负责全文叙述的人物小传信息。', '中性清晰', 'voice-1', '自然叙述', '否'],
  ['role_001', '林澈', 'character', '负责主要对白的人物小传信息。', '中性清晰', 'voice-2', '自然叙述', '否'],
];

test('keeps a current role when the stable role id still exists', () => {
  assert.equal(normalizeActiveRoleId(roles, 'role_001'), 'role_001');
});

test('moves focus to the first role when the current role is missing', () => {
  assert.equal(normalizeActiveRoleId(roles, 'removed-role'), 'narrator');
  assert.equal(normalizeActiveRoleId([], 'removed-role'), undefined);
});

test('returns an explicit class only for the active role row', () => {
  assert.equal(roleRowClassName('role_001', 'role_001'), 'role-focus-row role-focus-row-active');
  assert.equal(roleRowClassName('narrator', 'role_001'), 'role-focus-row');
});
