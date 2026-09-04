import type { StandardReferenceCandidate } from './types.ts';

export function passingStandardReferenceCandidates(candidates: StandardReferenceCandidate[]): StandardReferenceCandidate[] {
  return candidates.filter(candidate => (
    candidate.quality_passed
    && candidate.audio_quality_passed
    && candidate.speaker_verified
    && candidate.echo_verified
  ));
}
