import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVoiceGenerationPreset, normalizeVoiceGeneration, recommendedVoiceTraits, voiceTraitsInstruction } from './voiceControls.ts';

test('age recommendations create distinct child adult and older timbre vectors', () => {
  const child = recommendedVoiceTraits(10);
  const adult = recommendedVoiceTraits(35);
  const older = recommendedVoiceTraits(72);
  assert.ok(child.brightness > adult.brightness);
  assert.ok(child.resonance > adult.resonance);
  assert.ok(older.weight > adult.weight);
  assert.ok(older.roughness > adult.roughness);
  assert.ok(older.pace < adult.pace);
});

test('voice traits produce an explicit structured VoiceDesign instruction', () => {
  const text = voiceTraitsInstruction({ ...recommendedVoiceTraits(72), accent: '轻微北方口音' });
  assert.match(text, /声音重量偏厚/);
  assert.match(text, /音色亮度偏暗/);
  assert.match(text, /地域或口音要求：轻微北方口音/);
});

test('generation presets stay bounded and custom edits are retained', () => {
  const balanced = normalizeVoiceGeneration();
  const explore = applyVoiceGenerationPreset(balanced, 'explore');
  assert.ok(explore.temperature > balanced.temperature);
  assert.equal(explore.top_k, 100);
  const clamped = normalizeVoiceGeneration({ ...explore, preset: 'custom', candidate_count: 20, top_p: 4 });
  assert.equal(clamped.candidate_count, 6);
  assert.equal(clamped.top_p, 1);
});
