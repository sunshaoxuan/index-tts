import { normalizeCharacterAsset } from './characterVoiceProfile.ts';
import type { ProjectPayload, RoleRow, VoiceCandidate } from './types.ts';

export function candidatePitchAuditLabel(candidate: VoiceCandidate): string {
  const parts: string[] = [];
  if (Number.isFinite(candidate.raw_median_pitch_hz)) parts.push(`原始 ${Number(candidate.raw_median_pitch_hz).toFixed(1)} Hz`);
  if (Number.isFinite(candidate.pitch_correction_semitones) && Math.abs(Number(candidate.pitch_correction_semitones)) >= 0.005) {
    const correction = Number(candidate.pitch_correction_semitones);
    parts.push(`校准 ${correction > 0 ? '+' : ''}${correction.toFixed(2)} 半音`);
  }
  if (Number.isFinite(candidate.pitch_delta_hz) && Number.isFinite(candidate.pitch_target_tolerance_hz)) {
    parts.push(`目标偏差 ${Number(candidate.pitch_delta_hz).toFixed(1)} Hz / 容差 ±${Number(candidate.pitch_target_tolerance_hz).toFixed(1)} Hz`);
  }
  if (candidate.pitch_target_matched === true) parts.push('目标校验通过');
  if (candidate.pitch_target_matched === false) parts.push('目标校验未通过');
  return parts.join(' · ');
}

export function candidateVerificationLabel(age: number, gender: string, candidate: { gender_verified?: boolean; age_band_verified?: boolean; gender_identity_verified?: boolean }): string {
  if (age < 13 && (gender === 'female' || gender === 'male')) {
    const identity = gender === 'male' ? '男童' : '女童';
    if (candidate.age_band_verified === false) return '儿童声区校验未通过';
    if (candidate.gender_identity_verified === true) return `儿童声区通过 · ${identity}身份已由试听确认`;
    return `儿童声区通过 · ${identity}身份待试听确认`;
  }
  return candidate.gender_verified === false ? '历史候选待重新校验' : `${gender === 'male' ? '男性' : gender === 'female' ? '女性' : '声音'}校验通过`;
}

export function applyVoiceCandidateSelection(project: ProjectPayload, roleId: string, voiceId: string): ProjectPayload {
  const currentRole = project.roles.find(row => row[0] === roleId);
  if (!currentRole) throw new Error(`角色不存在：${roleId}`);
  const asset = normalizeCharacterAsset(currentRole, project.character_assets?.[roleId]);
  const candidates = asset.voice_candidates ?? [];
  if (!candidates.some(candidate => candidate.voice_id === voiceId && candidate.gender_verified !== false && candidate.age_band_verified !== false && candidate.pitch_target_matched !== false)) {
    throw new Error(`角色 ${currentRole[1]} 的候选音色不存在或未通过校验`);
  }
  const roles = project.roles.map(row => row[0] === roleId
    ? [row[0], row[1], row[2], row[3], row[4], voiceId, row[6], '否'] as RoleRow
    : row);
  return {
    ...project,
    roles,
    character_assets: {
      ...project.character_assets,
      [roleId]: {
        ...asset,
        voice_candidates: candidates.map(candidate => candidate.voice_id === voiceId
          ? { ...candidate, selected: true, ...(asset.age < 13 && asset.gender !== 'unspecified' ? { gender_identity_verified: true, gender_identity_method: 'human_listening' as const } : {}) }
          : { ...candidate, selected: false }),
      },
    },
  };
}

export function pendingVoiceSelectionRoleIds(project: ProjectPayload): string[] {
  return project.roles.flatMap(row => {
    if (String(row[5] || '').trim()) return [];
    const candidates = normalizeCharacterAsset(row, project.character_assets?.[row[0]]).voice_candidates ?? [];
    const verified = candidates.filter(candidate => candidate.gender_verified !== false);
    return verified.length > 0 && !verified.some(candidate => candidate.selected) ? [row[0]] : [];
  });
}
