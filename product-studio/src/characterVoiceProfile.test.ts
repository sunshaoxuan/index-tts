import test from 'node:test';
import assert from 'node:assert/strict';
import { ageVoiceConstraint, genderVoiceIdentityConstraint, normalizeCharacterAsset, recommendPitchRange, updateAssetDemographics } from './characterVoiceProfile.ts';
import type { RoleRow } from './types.ts';

const role: RoleRow = ['role_001', '林澈', 'character', '三十五岁的男性刑警，性格克制。', '低沉厚实', '', '自然叙述', '是'];

test('recommends distinct pitch ranges by gender and age', () => {
  const male = recommendPitchRange('male', 35);
  const female = recommendPitchRange('female', 35);
  const child = recommendPitchRange('unspecified', 10);
  assert.deepEqual([male.min, male.max], [85, 180]);
  assert.deepEqual([female.min, female.max], [180, 280]);
  assert.ok(child.min > male.min);
});

test('adds explicit perceived age timbre constraints', () => {
  assert.match(ageVoiceConstraint(55), /成熟偏老年声线/);
  assert.match(ageVoiceConstraint(55), /禁止明亮、轻薄、紧致的青年声线/);
  assert.match(ageVoiceConstraint(10), /儿童声线/);
});

test('uses child identity wording without adult male resonance instructions', () => {
  const instruction = genderVoiceIdentityConstraint('male', 10);
  assert.match(instruction, /尚未变声的男童/);
  assert.match(instruction, /成年男性胸腔共鸣/);
  assert.doesNotMatch(instruction, /保持明确男性声线、男性声带质感和男性共鸣/);
});

test('normalizes legacy roles into editable character assets', () => {
  const asset = normalizeCharacterAsset(role);
  assert.equal(asset.gender, 'male');
  assert.equal(asset.age, 35);
  assert.ok(asset.pitch_target_hz >= asset.pitch_min_hz);
  assert.ok(asset.pitch_target_hz <= asset.pitch_max_hz);
  assert.equal(asset.portrait_style, 'cinematic_manga');
  assert.equal(asset.voice_generation.preset, 'balanced');
  assert.equal(asset.voice_generation.candidate_count, 3);
  assert.ok(asset.audition_text.length > 0);
});

test('preserves a supported portrait style and falls back from an unknown style', () => {
  assert.equal(normalizeCharacterAsset(role, { portrait_style: 'noir_ink', portrait_notes: '保留旧式礼帽' }).portrait_style, 'noir_ink');
  assert.equal(normalizeCharacterAsset(role, { portrait_style: 'commercial-style-name' }).portrait_style, 'cinematic_manga');
});

test('changing demographics resets the recommendation and target', () => {
  const current = normalizeCharacterAsset(role, { pitch_target_hz: 90 });
  const updated = updateAssetDemographics(current, 'female', 70);
  assert.deepEqual([updated.pitch_min_hz, updated.pitch_max_hz, updated.pitch_target_hz], [155, 250, 203]);
  assert.ok(updated.voice_traits.weight > current.voice_traits.weight);
  assert.ok(updated.voice_traits.roughness > current.voice_traits.roughness);
});

test('preserves uploaded reference audio metadata during character normalization', () => {
  const asset = normalizeCharacterAsset(role, { reference_audio: {
    voice_id: 'voice-upload-0123456789abcdef',
    original_name: 'reference.mp3',
    uploaded_at: '2026-09-03T00:00:00.000Z',
    source_format: 'mp3',
    size_bytes: 12345,
  } });

  assert.deepEqual(asset.reference_audio, {
    voice_id: 'voice-upload-0123456789abcdef',
    original_name: 'reference.mp3',
    uploaded_at: '2026-09-03T00:00:00.000Z',
    source_format: 'mp3',
    size_bytes: 12345,
  });
});
