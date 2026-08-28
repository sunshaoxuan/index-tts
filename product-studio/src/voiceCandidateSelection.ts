import { normalizeCharacterAsset } from './characterVoiceProfile.ts';
import type { ProjectPayload, RoleRow } from './types.ts';

export function applyVoiceCandidateSelection(project: ProjectPayload, roleId: string, voiceId: string): ProjectPayload {
  const currentRole = project.roles.find(row => row[0] === roleId);
  if (!currentRole) throw new Error(`角色不存在：${roleId}`);
  const asset = normalizeCharacterAsset(currentRole, project.character_assets?.[roleId]);
  const candidates = asset.voice_candidates ?? [];
  if (!candidates.some(candidate => candidate.voice_id === voiceId && candidate.gender_verified !== false)) {
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
        voice_candidates: candidates.map(candidate => ({ ...candidate, selected: candidate.voice_id === voiceId })),
      },
    },
  };
}

export function pendingVoiceSelectionRoleIds(project: ProjectPayload): string[] {
  return project.roles.flatMap(row => {
    const candidates = normalizeCharacterAsset(row, project.character_assets?.[row[0]]).voice_candidates ?? [];
    const verified = candidates.filter(candidate => candidate.gender_verified !== false);
    return verified.length > 0 && !verified.some(candidate => candidate.selected) ? [row[0]] : [];
  });
}
