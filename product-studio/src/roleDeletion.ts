import type { ProjectPayload, RoleRow, SegmentRow } from './types';

const NARRATOR_ROLE: RoleRow = ['narrator', '旁白', 'narrator', '负责环境、动作、心理活动与说话归属的全篇叙事视角。', '中性清晰', '', '自然叙述', '是'];

export function stopRoleDeleteCardActivation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function reassignSegments(rows: SegmentRow[] | undefined, roleId: string) {
  let reassigned = 0;
  const segments = (rows ?? []).map(row => {
    if (row[2] !== roleId) return row;
    reassigned += 1;
    const updated = [...row] as SegmentRow;
    updated[2] = 'narrator';
    updated[3] = '旁白';
    return updated;
  });
  return { segments, reassigned };
}

export function deleteProjectRole(project: ProjectPayload, roleId: string) {
  if (roleId === 'narrator') throw new Error('旁白是原文覆盖和安全回退的基础轨道，不能删除');
  const removed = project.roles.find(row => row[0] === roleId);
  if (!removed) throw new Error('角色不存在或已经删除');
  const reassigned = reassignSegments(project.segments, roleId);
  const roles = project.roles.filter(row => row[0] !== roleId);
  if (reassigned.reassigned && !roles.some(row => row[0] === 'narrator')) roles.unshift([...NARRATOR_ROLE]);
  const characterAssets = { ...project.character_assets };
  delete characterAssets[roleId];

  const document = { ...(project.document ?? {}) } as Record<string, unknown>;
  if (Array.isArray(document.characters)) document.characters = document.characters.filter(item => String((item as { id?: string })?.id || '') !== roleId);
  if (Array.isArray(document.segments)) {
    document.segments = document.segments.map(item => {
      const segment = item as Record<string, unknown>;
      if (String(segment.speaker_id || '') !== roleId) return item;
      return { ...segment, speaker_id: 'narrator', speaker_name: '旁白', speaker_kind: 'narrator', speaker_candidates: ['narrator'], speaker_confidence: 1, speaker_evidence: '用户删除原角色后明确重分配到旁白' };
    });
  }

  const memory = project.director_memory;
  const memorySegments = reassignSegments(memory?.segments, roleId).segments;
  const memoryAssets = { ...(memory?.character_assets ?? {}) };
  delete memoryAssets[roleId];
  const directorMemory = memory ? {
    ...memory,
    roles: memory.roles.filter(row => row[0] !== roleId),
    character_assets: memoryAssets,
    segments: memorySegments,
  } : memory;

  return {
    project: { ...project, roles, character_assets: characterAssets, segments: reassigned.segments, document, director_memory: directorMemory },
    removedRoleName: removed[1],
    reassignedSegments: reassigned.reassigned,
  };
}
