import type { StandardReferenceCandidate } from './types.ts';

export const STANDARD_REFERENCE_DELIVERY_COUNT = 3;

export function passingStandardReferenceCandidates(candidates: StandardReferenceCandidate[]): StandardReferenceCandidate[] {
  return candidates.filter(candidate => (
    candidate.quality_passed
    && candidate.audio_quality_passed
    && candidate.speaker_verified
    && candidate.echo_verified
  ));
}

export function completeStandardReferenceCandidates(candidates: StandardReferenceCandidate[]): StandardReferenceCandidate[] {
  const passing = passingStandardReferenceCandidates(candidates);
  return passing.length >= STANDARD_REFERENCE_DELIVERY_COUNT
    ? passing.slice(0, STANDARD_REFERENCE_DELIVERY_COUNT)
    : [];
}
