import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteProjectRole, stopRoleDeleteCardActivation } from './roleDeletion.ts';
import type { ProjectPayload } from './types.ts';

function project(): ProjectPayload {
  return {
    project_id: 'demo', title: '测试', content_type: 'novel', source_text: '原文', guidance: '', pronunciations: [],
    roles: [
      ['narrator', '旁白', 'narrator', '负责全文叙事。', '中性清晰', '', '自然叙述', '否'],
      ['role_001', '误识别人物', 'character', '模型产物。', '中性清晰', '', '自然叙述', '否'],
    ],
    character_assets: { role_001: {} as never },
    segments: [[1, '正文', 'role_001', '误识别人物', 'ZH', '原文', '原文', '中性叙述', '平静', 0.5, '自然', 300]],
    document: { characters: [{ id: 'narrator' }, { id: 'role_001' }], segments: [{ speaker_id: 'role_001', speaker_name: '误识别人物', speaker_kind: 'character' }] },
    director_memory: { source_text: '原文', roles: [['role_001', '误识别人物', 'character', '模型产物。', '中性清晰', '', '自然叙述', '否']], character_assets: { role_001: {} as never }, segments: [[1, '正文', 'role_001', '误识别人物', 'ZH', '原文', '原文', '中性叙述', '平静', 0.5, '自然', 300]], pronunciations: [] },
  };
}

test('deletes a model-created role and reassigns every reference to narrator', () => {
  const result = deleteProjectRole(project(), 'role_001');
  assert.equal(result.removedRoleName, '误识别人物');
  assert.equal(result.reassignedSegments, 1);
  assert.deepEqual(result.project.roles.map(row => row[0]), ['narrator']);
  assert.deepEqual(result.project.segments[0].slice(2, 4), ['narrator', '旁白']);
  assert.equal(Object.hasOwn(result.project.character_assets, 'role_001'), false);
  assert.equal((result.project.document?.characters as Array<{ id: string }>).some(item => item.id === 'role_001'), false);
  assert.equal((result.project.document?.segments as Array<{ speaker_id: string }>)[0].speaker_id, 'narrator');
  assert.deepEqual(result.project.director_memory?.roles, []);
  assert.equal(result.project.director_memory?.segments[0][2], 'narrator');
});

test('preserves narrator as the required fallback role', () => {
  assert.throws(() => deleteProjectRole(project(), 'narrator'), /不能删除/);
});

test('isolates the delete control from the role card activation handler', () => {
  let stopped = false;
  stopRoleDeleteCardActivation({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
});
