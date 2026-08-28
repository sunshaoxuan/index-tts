import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVoiceCandidateSelection, pendingVoiceSelectionRoleIds } from './voiceCandidateSelection.ts';
import type { ProjectPayload } from './types.ts';

const project = {
  project_id: 'demo', title: 'demo', content_type: 'novel', source_text: '', guidance: '',
  roles: [['role_child', '桐原亮', 'character', '十岁男孩', '沉默的男孩声音', '', '自然叙述', '否']],
  character_assets: { role_child: { gender: 'male', age: 10, voice_candidates: [
    { voice_id: 'voice-a', seed: 42, median_pitch_hz: 221, selected: false, gender_verified: true },
    { voice_id: 'voice-b', seed: 43, median_pitch_hz: 236, selected: false, gender_verified: true },
    { voice_id: 'voice-c', seed: 44, median_pitch_hz: 248, selected: false, gender_verified: true },
  ] } },
  segments: [], pronunciations: [],
} as unknown as ProjectPayload;

test('keeps three generated candidates pending until the user chooses one', () => {
  assert.deepEqual(pendingVoiceSelectionRoleIds(project), ['role_child']);
  assert.equal(project.roles[0][5], '');
});

test('choosing a candidate updates only the role voice and selected flags', () => {
  const selected = applyVoiceCandidateSelection(project, 'role_child', 'voice-b');
  assert.equal(selected.roles[0][5], 'voice-b');
  assert.equal(selected.roles[0][7], '否');
  assert.deepEqual(selected.character_assets.role_child.voice_candidates?.map(item => item.selected), [false, true, false]);
  assert.deepEqual(pendingVoiceSelectionRoleIds(selected), []);
  assert.equal(project.roles[0][5], '');
});

test('does not ask for a new decision when a stable role voice already exists', () => {
  const stable = structuredClone(project);
  stable.roles[0][5] = 'voice-stable';
  assert.deepEqual(pendingVoiceSelectionRoleIds(stable), []);
});
