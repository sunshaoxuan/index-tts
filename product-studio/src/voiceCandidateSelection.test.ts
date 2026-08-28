import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVoiceCandidateSelection, candidatePitchAuditLabel, candidateVerificationLabel, pendingVoiceSelectionRoleIds } from './voiceCandidateSelection.ts';
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
  assert.equal(selected.character_assets.role_child.voice_candidates?.[1].gender_identity_verified, true);
  assert.equal(selected.character_assets.role_child.voice_candidates?.[1].gender_identity_method, 'human_listening');
  assert.deepEqual(pendingVoiceSelectionRoleIds(selected), []);
  assert.equal(project.roles[0][5], '');
});

test('child verification label separates acoustic age band from listening identity', () => {
  assert.equal(candidateVerificationLabel(10, 'male', project.character_assets.role_child.voice_candidates![0]), '儿童声区通过 · 男童身份待试听确认');
  const confirmed = applyVoiceCandidateSelection(project, 'role_child', 'voice-a');
  assert.equal(candidateVerificationLabel(10, 'male', confirmed.character_assets.role_child.voice_candidates![0]), '儿童声区通过 · 男童身份已由试听确认');
});

test('does not ask for a new decision when a stable role voice already exists', () => {
  const stable = structuredClone(project);
  stable.roles[0][5] = 'voice-stable';
  assert.deepEqual(pendingVoiceSelectionRoleIds(stable), []);
});

test('shows auditable target pitch calibration details', () => {
  assert.equal(candidatePitchAuditLabel({
    voice_id: 'voice-calibrated', seed: 42, raw_median_pitch_hz: 107.89, median_pitch_hz: 146.2,
    pitch_delta_hz: 0.8, pitch_target_tolerance_hz: 7.35, pitch_target_matched: true,
    pitch_correction_semitones: 5.274, pitch_correction_method: 'librosa_phase_vocoder', selected: false,
  }), '原始 107.9 Hz · 校准 +5.27 半音 · 目标偏差 0.8 Hz / 容差 ±7.3 Hz · 目标校验通过');
});

test('rejects a candidate that failed the target pitch gate', () => {
  const invalid = structuredClone(project);
  invalid.character_assets.role_child.voice_candidates![0].pitch_target_matched = false;
  assert.throws(() => applyVoiceCandidateSelection(invalid, 'role_child', 'voice-a'), /不存在或未通过校验/);
});
