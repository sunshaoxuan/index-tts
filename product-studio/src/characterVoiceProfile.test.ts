import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCharacterAsset, recommendPitchRange, updateAssetDemographics } from './characterVoiceProfile.ts';
import type { RoleRow } from './types.ts';

const role: RoleRow = ['role_001', '林澈', 'character', '三十五岁的男性刑警，性格克制。', '低沉厚实', '', '自然叙述', '是'];

test('recommends distinct pitch ranges by gender and age', () => {
  const male = recommendPitchRange('male', 35);
  const female = recommendPitchRange('female', 35);
  const child = recommendPitchRange('unspecified', 10);
  assert.deepEqual([male.min, male.max], [85, 180]);
  assert.deepEqual([female.min, female.max], [165, 255]);
  assert.ok(child.min > male.min);
});

test('normalizes legacy roles into editable character assets', () => {
  const asset = normalizeCharacterAsset(role);
  assert.equal(asset.gender, 'male');
  assert.equal(asset.age, 35);
  assert.ok(asset.pitch_target_hz >= asset.pitch_min_hz);
  assert.ok(asset.pitch_target_hz <= asset.pitch_max_hz);
});

test('changing demographics resets the recommendation and target', () => {
  const current = normalizeCharacterAsset(role, { pitch_target_hz: 90 });
  const updated = updateAssetDemographics(current, 'female', 70);
  assert.deepEqual([updated.pitch_min_hz, updated.pitch_max_hz, updated.pitch_target_hz], [135, 235, 185]);
});
