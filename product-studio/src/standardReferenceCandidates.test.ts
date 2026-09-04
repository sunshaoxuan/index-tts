import assert from 'node:assert/strict';
import test from 'node:test';
import { completeStandardReferenceCandidates, passingStandardReferenceCandidates } from './standardReferenceCandidates.ts';
import type { StandardReferenceCandidate } from './types.ts';

function candidate(rank: number, overrides: Partial<StandardReferenceCandidate> = {}): StandardReferenceCandidate {
  return {
    voice_id: `voice-standard-${rank}`,
    rank,
    duration_seconds: 4.2,
    audio_quality_passed: true,
    speaker_similarity: 0.82,
    speaker_similarity_threshold: 0.72,
    speaker_verified: true,
    echo_similarity: 0.12,
    echo_threshold: 0.72,
    echo_verified: true,
    quality_passed: true,
    score: 90,
    selected: false,
    generated_at: '2026-09-04T00:00:00Z',
    ...overrides,
  };
}

test('shows only candidates that passed every standard reference gate', () => {
  const visible = passingStandardReferenceCandidates([
    candidate(1),
    candidate(2, { quality_passed: false, speaker_verified: false }),
    candidate(3, { quality_passed: false, echo_verified: false }),
  ]);

  assert.deepEqual(visible.map(item => item.voice_id), ['voice-standard-1']);
});

test('returns an empty list when every standard reference candidate failed', () => {
  const visible = passingStandardReferenceCandidates([
    candidate(1, { quality_passed: false, audio_quality_passed: false }),
    candidate(2, { quality_passed: false, speaker_verified: false }),
  ]);

  assert.deepEqual(visible, []);
});

test('withholds an incomplete historical candidate set', () => {
  const visible = completeStandardReferenceCandidates([
    candidate(1),
    candidate(2, { quality_passed: false, speaker_verified: false }),
    candidate(3, { quality_passed: false, speaker_verified: false }),
  ]);

  assert.deepEqual(visible, []);
});

test('delivers exactly three candidates only when all three passed every gate', () => {
  const visible = completeStandardReferenceCandidates([
    candidate(1),
    candidate(2),
    candidate(3),
    candidate(4),
  ]);

  assert.deepEqual(visible.map(item => item.voice_id), [
    'voice-standard-1',
    'voice-standard-2',
    'voice-standard-3',
  ]);
});
