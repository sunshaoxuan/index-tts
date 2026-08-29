import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceProjectRole } from './roleReplacement.ts';
import type { ProjectPayload } from './types.ts';

function project(): ProjectPayload {
  return {
    project_id: 'demo', title: '测试', content_type: 'novel', source_text: '原文', guidance: '', pronunciations: [],
    roles: [
      ['narrator', '旁白', 'narrator', '负责全文叙事。', '中性清晰', 'voice-narrator', '自然叙述', '否'],
      ['role_existing', '桐原弥生子', 'character', '前篇已经建立的人物资产。', '成熟克制', 'voice-existing', '自然叙述', '否'],
      ['role_new', '死者妻子', 'character', '本篇 AI 重复生成的人物。', '悲伤女性', '', '自然叙述', '是'],
    ],
    character_assets: {
      narrator: { portrait_style: 'manga' } as never,
      role_existing: { portrait_style: 'manga', voice_candidates: [{ voice_id: 'voice-existing', seed: 1, selected: true }] } as never,
      role_new: { portrait_style: 'manga', voice_candidates: [] } as never,
    },
    segments: [
      [1, '正文', 'role_new', '死者妻子', 'ZH', '甲。', '甲。', '中性叙述', '平静', 0.5, '自然', 300],
      [2, '正文', 'role_existing', '桐原弥生子', 'ZH', '乙。', '乙。', '中性叙述', '平静', 0.5, '自然', 300],
    ],
    document: {
      characters: [
        { id: 'role_existing', name: '桐原弥生子', kind: 'character', aliases: ['弥生子'] },
        { id: 'role_new', name: '死者妻子', kind: 'character', aliases: ['老板娘'] },
      ],
      scenes: [{ id: 'scene_1', participants: ['role_new', 'role_existing'] }],
      segments: [{ speaker_id: 'role_new', speaker_name: '死者妻子', speaker_candidates: ['role_new', 'role_existing'] }],
      guidance_routing: { assignments: [{ target_role_ids: ['role_new'], target_role_names: ['死者妻子'] }] },
      linked_role_merge: { generated_to_final: { ai_wife: 'role_new', ai_narrator: 'narrator' } },
    },
    director_memory: {
      source_text: '原文',
      roles: [
        ['role_existing', '桐原弥生子', 'character', '前篇已经建立的人物资产。', '成熟克制', 'voice-existing', '自然叙述', '否'],
        ['role_new', '死者妻子', 'character', '本篇 AI 重复生成的人物。', '悲伤女性', '', '自然叙述', '是'],
      ],
      character_assets: { role_existing: { portrait_style: 'manga' } as never, role_new: { portrait_style: 'manga' } as never },
      segments: [[1, '正文', 'role_new', '死者妻子', 'ZH', '甲。', '甲。', '中性叙述', '平静', 0.5, '自然', 300]],
      pronunciations: [],
    },
    linked_projects: [{
      source_project_id: 'source', source_project_title: '前篇', imported_at: '2026-08-30T00:00:00Z',
      roles: [{ source_role_id: 'role_old', target_role_id: 'role_new', name: '死者妻子', voice_ids: [], available_voice_ids: [], missing_voice_ids: [] }],
      pronunciations: { imported_count: 0, duplicate_rules: [], conflict_rules: [] },
    }],
  };
}

test('replaces a duplicate role with an existing role across active director data', () => {
  const result = replaceProjectRole(project(), 'role_new', 'role_existing', '2026-08-30T01:02:03Z');
  assert.equal(result.sourceRoleName, '死者妻子');
  assert.equal(result.targetRoleName, '桐原弥生子');
  assert.equal(result.reassignedSegments, 1);
  assert.deepEqual(result.project.roles.map(row => row[0]), ['narrator', 'role_existing']);
  assert.deepEqual(result.project.segments.map(row => row.slice(2, 4)), [['role_existing', '桐原弥生子'], ['role_existing', '桐原弥生子']]);
  assert.equal(Object.hasOwn(result.project.character_assets, 'role_new'), false);
  assert.equal(result.project.character_assets.role_existing.voice_candidates?.[0].voice_id, 'voice-existing');

  const document = result.project.document as Record<string, any>;
  assert.deepEqual(document.characters.map((item: { id: string }) => item.id), ['role_existing']);
  assert.deepEqual(document.characters[0].aliases.sort(), ['弥生子', '死者妻子', '老板娘'].sort());
  assert.deepEqual(document.scenes[0].participants, ['role_existing']);
  assert.equal(document.segments[0].speaker_id, 'role_existing');
  assert.equal(document.segments[0].speaker_name, '桐原弥生子');
  assert.deepEqual(document.segments[0].speaker_candidates, ['role_existing']);
  assert.deepEqual(document.guidance_routing.assignments[0], { target_role_ids: ['role_existing'], target_role_names: ['桐原弥生子'] });
  assert.equal(document.linked_role_merge.generated_to_final.ai_wife, 'role_existing');
  assert.deepEqual(document.role_replacements[0], {
    recorded_at: '2026-08-30T01:02:03Z', source_role_id: 'role_new', source_role_name: '死者妻子', target_role_id: 'role_existing', target_role_name: '桐原弥生子',
  });
  assert.deepEqual(result.project.director_memory?.roles.map(row => row[0]), ['role_existing']);
  assert.deepEqual(result.project.director_memory?.segments[0].slice(2, 4), ['role_existing', '桐原弥生子']);
  assert.equal(result.project.linked_projects?.[0].roles[0].target_role_id, 'role_existing');
});

test('rejects invalid source and target selections', () => {
  assert.throws(() => replaceProjectRole(project(), 'narrator', 'role_existing'), /不能被其他角色替换/);
  assert.throws(() => replaceProjectRole(project(), 'role_new', 'role_new'), /不同的目标角色/);
  assert.throws(() => replaceProjectRole(project(), 'missing', 'role_existing'), /待替换角色不存在/);
  assert.throws(() => replaceProjectRole(project(), 'role_new', 'missing'), /目标角色不存在/);
});
