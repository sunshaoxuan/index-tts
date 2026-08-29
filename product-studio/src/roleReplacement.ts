import type { ProjectPayload, RoleRow, SegmentRow } from './types';

function replaceRoleIds(values: unknown, sourceRoleId: string, targetRoleId: string): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(value => String(value) === sourceRoleId ? targetRoleId : String(value)).filter(Boolean))];
}

function replaceSegments(rows: SegmentRow[] | undefined, sourceRoleId: string, targetRole: RoleRow) {
  let reassigned = 0;
  const segments = (rows ?? []).map(row => {
    if (row[2] !== sourceRoleId) return row;
    reassigned += 1;
    const updated = [...row] as SegmentRow;
    updated[2] = targetRole[0];
    updated[3] = targetRole[1];
    return updated;
  });
  return { segments, reassigned };
}

function replaceDocumentReferences(documentInput: Record<string, unknown> | undefined, sourceRole: RoleRow, targetRole: RoleRow, recordedAt: string) {
  const document = { ...(documentInput ?? {}) };
  const characters = Array.isArray(document.characters) ? document.characters.map(item => ({ ...(item as Record<string, unknown>) })) : [];
  const sourceCharacter = characters.find(item => String(item.id || '') === sourceRole[0]);
  const targetCharacter = characters.find(item => String(item.id || '') === targetRole[0]);
  const sourceAliases = Array.isArray(sourceCharacter?.aliases) ? sourceCharacter.aliases.map(String) : [];
  const rememberedAliases = [...new Set([targetRole[1], sourceRole[1], ...sourceAliases].map(value => value.trim()).filter(value => value && value !== targetRole[1]))];
  if (targetCharacter) {
    const currentAliases = Array.isArray(targetCharacter.aliases) ? targetCharacter.aliases.map(String) : [];
    targetCharacter.aliases = [...new Set([...currentAliases, ...rememberedAliases])];
  } else {
    characters.push({
      id: targetRole[0], name: targetRole[1], kind: targetRole[2], profile: targetRole[3], voice_hint: targetRole[4],
      aliases: rememberedAliases, confidence: 1, evidence: `用户将角色“${sourceRole[1]}”合并到该角色`,
    });
  }
  document.characters = characters.filter(item => String(item.id || '') !== sourceRole[0]);

  if (Array.isArray(document.segments)) {
    document.segments = document.segments.map(item => {
      const segment = item as Record<string, unknown>;
      const candidates = replaceRoleIds(segment.speaker_candidates, sourceRole[0], targetRole[0]);
      if (String(segment.speaker_id || '') !== sourceRole[0]) {
        return candidates.length ? { ...segment, speaker_candidates: candidates } : item;
      }
      return {
        ...segment,
        speaker_id: targetRole[0],
        speaker_name: targetRole[1],
        speaker_kind: targetRole[2],
        speaker_candidates: candidates.length ? candidates : [targetRole[0]],
        speaker_confidence: 1,
        speaker_evidence: `用户将角色“${sourceRole[1]}”替换为“${targetRole[1]}”`,
      };
    });
  }

  if (Array.isArray(document.scenes)) {
    document.scenes = document.scenes.map(item => {
      const scene = item as Record<string, unknown>;
      return { ...scene, participants: replaceRoleIds(scene.participants, sourceRole[0], targetRole[0]) };
    });
  }

  const routing = document.guidance_routing as Record<string, unknown> | undefined;
  if (routing && Array.isArray(routing.assignments)) {
    document.guidance_routing = {
      ...routing,
      assignments: routing.assignments.map(item => {
        const assignment = item as Record<string, unknown>;
        const targetRoleIds = replaceRoleIds(assignment.target_role_ids, sourceRole[0], targetRole[0]);
        const originalIds = Array.isArray(assignment.target_role_ids) ? assignment.target_role_ids.map(String) : [];
        const originalNames = Array.isArray(assignment.target_role_names) ? assignment.target_role_names.map(String) : [];
        return {
          ...assignment,
          target_role_ids: targetRoleIds,
          target_role_names: targetRoleIds.map(roleId => roleId === targetRole[0] ? targetRole[1] : originalNames[originalIds.indexOf(roleId)] || roleId),
        };
      }),
    };
  }

  const mergeReport = document.linked_role_merge as Record<string, unknown> | undefined;
  if (mergeReport?.generated_to_final && typeof mergeReport.generated_to_final === 'object') {
    document.linked_role_merge = {
      ...mergeReport,
      generated_to_final: Object.fromEntries(Object.entries(mergeReport.generated_to_final as Record<string, unknown>).map(([key, value]) => [key, String(value) === sourceRole[0] ? targetRole[0] : value])),
    };
  }

  const replacements = Array.isArray(document.role_replacements) ? document.role_replacements : [];
  document.role_replacements = [...replacements, {
    recorded_at: recordedAt,
    source_role_id: sourceRole[0],
    source_role_name: sourceRole[1],
    target_role_id: targetRole[0],
    target_role_name: targetRole[1],
  }];
  return document;
}

export function replaceProjectRole(project: ProjectPayload, sourceRoleId: string, targetRoleId: string, recordedAt = new Date().toISOString()) {
  if (sourceRoleId === 'narrator') throw new Error('旁白是全篇稳定基础角色，不能被其他角色替换');
  if (sourceRoleId === targetRoleId) throw new Error('请选择与当前角色不同的目标角色');
  const sourceRole = project.roles.find(row => row[0] === sourceRoleId);
  const targetRole = project.roles.find(row => row[0] === targetRoleId);
  if (!sourceRole) throw new Error('待替换角色不存在或已经被删除');
  if (!targetRole) throw new Error('目标角色不存在');

  const reassigned = replaceSegments(project.segments, sourceRoleId, targetRole);
  const characterAssets = { ...project.character_assets };
  delete characterAssets[sourceRoleId];
  const document = replaceDocumentReferences(project.document, sourceRole, targetRole, recordedAt);

  const memory = project.director_memory;
  const memorySegments = replaceSegments(memory?.segments, sourceRoleId, targetRole).segments;
  const memoryAssets = { ...(memory?.character_assets ?? {}) };
  delete memoryAssets[sourceRoleId];
  if (!memoryAssets[targetRoleId] && project.character_assets[targetRoleId]) memoryAssets[targetRoleId] = project.character_assets[targetRoleId];
  const memoryRoles = memory ? memory.roles.filter(row => row[0] !== sourceRoleId) : [];
  if (memory && !memoryRoles.some(row => row[0] === targetRoleId)) memoryRoles.push([...targetRole]);
  const directorMemory = memory ? { ...memory, roles: memoryRoles, character_assets: memoryAssets, segments: memorySegments } : memory;

  const linkedProjects = project.linked_projects?.map(link => ({
    ...link,
    roles: link.roles.map(role => role.target_role_id === sourceRoleId ? { ...role, target_role_id: targetRoleId } : role),
  }));

  return {
    project: {
      ...project,
      roles: project.roles.filter(row => row[0] !== sourceRoleId),
      character_assets: characterAssets,
      segments: reassigned.segments,
      document,
      director_memory: directorMemory,
      linked_projects: linkedProjects,
    },
    sourceRoleName: sourceRole[1],
    targetRoleName: targetRole[1],
    reassignedSegments: reassigned.reassigned,
  };
}
