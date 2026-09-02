export interface ManualStoryboardSceneDraft {
  startSegmentOrder: number;
  endSegmentOrder: number;
  title: string;
  topic: string;
  location: string;
  spatialDirection: string;
  time: string;
  narrativePerspective: string;
  mood: string;
  storyboardNote: string;
  boundaryReason: string;
}

export interface StoryboardEditResult {
  document: Record<string, unknown>;
  sceneId: string;
  shotId: string;
}

export function toggleStoryboardShotSelection(
  selectedIds: string[],
  sceneShotIds: string[],
  shotId: string,
  checked: boolean,
) {
  if (!checked) return selectedIds.filter(id => id !== shotId);
  const sceneIds = new Set(sceneShotIds);
  const selectedInScene = selectedIds.filter(id => sceneIds.has(id));
  return selectedInScene.includes(shotId) ? selectedInScene : [...selectedInScene, shotId];
}

const GENERATED_FIELDS = [
  'keyframe_url', 'keyframe_prompt', 'keyframe_style', 'keyframe_generated_at', 'keyframe_model',
  'keyframe_requested_model', 'keyframe_model_fallback_used', 'keyframe_model_fallback_reason',
  'keyframe_model_prompt_profile', 'identity_reference_mode', 'reference_characters',
] as const;

function cleanGenerated(shot: Record<string, unknown>) {
  const copy = { ...shot };
  for (const field of GENERATED_FIELDS) delete copy[field];
  return copy;
}

function nextId(prefix: string, used: Set<string>) {
  let sequence = 1;
  while (used.has(`${prefix}_${String(sequence).padStart(3, '0')}`)) sequence += 1;
  const id = `${prefix}_${String(sequence).padStart(3, '0')}`;
  used.add(id);
  return id;
}

function required(value: string, label: string) {
  const cleaned = String(value || '').trim();
  if (!cleaned) throw new Error(`请填写${label}`);
  return cleaned;
}

function sourceForSegments(segments: Array<Record<string, unknown>>) {
  return segments.map(segment => String(segment.source_text || segment.text || '')).join('').trim();
}

function applyShotSource(shot: Record<string, unknown>, segments: Array<Record<string, unknown>>) {
  const sourceText = sourceForSegments(segments);
  shot.source_text = sourceText;
  shot.source_excerpt = sourceText.slice(0, 500);
  return shot;
}

function documentParts(sourceDocument: Record<string, unknown>) {
  const document = structuredClone(sourceDocument || {});
  const segments = (Array.isArray(document.segments) ? document.segments : [])
    .filter(item => item && typeof item === 'object')
    .map(item => ({ ...(item as Record<string, unknown>) }))
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  const scenes = (Array.isArray(document.scenes) ? document.scenes : [])
    .filter(item => item && typeof item === 'object')
    .map(item => ({ ...(item as Record<string, unknown>) }));
  if (!segments.length || !scenes.length) throw new Error('当前工程没有可编辑的场景与分句，请先重新生成全部分镜');
  return { document, segments, scenes };
}

function sceneShots(scene: Record<string, unknown>, sceneSegments: Array<Record<string, unknown>>) {
  const shots = (Array.isArray(scene.shots) ? scene.shots : [])
    .filter(item => item && typeof item === 'object')
    .map(item => ({ ...(item as Record<string, unknown>) }));
  if (shots.length) return shots;
  const first = Number(sceneSegments[0]?.order || scene.start_segment_order || 0);
  const last = Number(sceneSegments.at(-1)?.order || scene.end_segment_order || first);
  return [{
    id: `${String(scene.id)}_shot_001`,
    title: `${String(scene.title || scene.id)} · 镜头 001`,
    storyboard_note: String(scene.storyboard_note || ''),
    source_text: sourceForSegments(sceneSegments),
    source_excerpt: sourceForSegments(sceneSegments).slice(0, 500),
    participants: scene.participants || [],
    start_segment_order: first,
    end_segment_order: last,
    authoring: 'legacy_scene',
  }];
}

export function createManualStoryboardShot(
  sourceDocument: Record<string, unknown>,
  draft: ManualStoryboardSceneDraft,
): StoryboardEditResult {
  const { document, segments, scenes } = documentParts(sourceDocument);
  const start = Number(draft.startSegmentOrder);
  const end = Number(draft.endSegmentOrder);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) throw new Error('分镜镜头的起止分句范围无效');
  const selected = segments.filter(segment => Number(segment.order) >= start && Number(segment.order) <= end);
  if (!selected.length || Number(selected[0].order) !== start || Number(selected.at(-1)?.order) !== end) throw new Error('起始分句或结束分句已经变化，请重新选择');
  const selectedSceneIds = [...new Set(selected.map(segment => String(segment.scene_id || '')))];
  if (selectedSceneIds.length !== 1 || !selectedSceneIds[0]) throw new Error('一个分镜镜头只能位于同一场景内，请缩小起止分句范围');
  const sceneId = selectedSceneIds[0];
  const sceneIndex = scenes.findIndex(scene => String(scene.id || '') === sceneId);
  if (sceneIndex < 0) throw new Error('所选分句对应的场景不存在');
  const scene = scenes[sceneIndex];
  const sceneSegments = segments.filter(segment => String(segment.scene_id || '') === sceneId);
  const shots = sceneShots(scene, sceneSegments);
  const used = new Set(shots.map(shot => String(shot.id || '')).filter(Boolean));
  const manualId = nextId(`${sceneId}_manual`, used);
  const shotByOrder = new Map<number, string>();
  for (const shot of shots) {
    const shotStart = Number(shot.start_segment_order || 0);
    const shotEnd = Number(shot.end_segment_order || shotStart);
    for (const segment of sceneSegments) {
      const order = Number(segment.order);
      if (order >= shotStart && order <= shotEnd && !shotByOrder.has(order)) shotByOrder.set(order, String(shot.id));
    }
  }
  for (const segment of sceneSegments) {
    const order = Number(segment.order);
    if (!shotByOrder.has(order)) shotByOrder.set(order, String(shots[0].id));
    if (order >= start && order <= end) shotByOrder.set(order, manualId);
  }
  const originalById = new Map(shots.map(shot => [String(shot.id), shot]));
  const groups: Array<{ sourceId: string; segments: Array<Record<string, unknown>> }> = [];
  for (const segment of sceneSegments) {
    const sourceId = String(shotByOrder.get(Number(segment.order)));
    const last = groups.at(-1);
    if (last?.sourceId === sourceId) last.segments.push(segment);
    else groups.push({ sourceId, segments: [segment] });
  }
  const occurrence = new Map<string, number>();
  const rebuilt = groups.map(group => {
    const count = occurrence.get(group.sourceId) || 0;
    occurrence.set(group.sourceId, count + 1);
    let shotId = group.sourceId;
    let shot: Record<string, unknown>;
    if (group.sourceId === manualId) {
      const storyboardNote = required(draft.storyboardNote, '镜头画面小记');
      if (storyboardNote.length < 20) throw new Error('镜头画面小记至少填写 20 个字符');
      shot = {
        id: manualId,
        title: required(draft.title, '分镜镜头标题'),
        topic: String(draft.topic || '').trim(),
        location: String(draft.location || '').trim(),
        spatial_direction: String(draft.spatialDirection || '').trim(),
        time: String(draft.time || '').trim(),
        narrative_perspective: String(draft.narrativePerspective || '').trim(),
        mood: String(draft.mood || '').trim(),
        storyboard_note: storyboardNote,
        boundary_reason: required(draft.boundaryReason, '镜头切换依据'),
        authoring: 'manual',
      };
    } else {
      const original = originalById.get(group.sourceId) || { id: group.sourceId, title: group.sourceId };
      shot = { ...original };
      if (count > 0) {
        shotId = nextId(`${sceneId}_split`, used);
        shot = cleanGenerated(shot);
        shot.id = shotId;
        shot.title = `${String(shot.title || group.sourceId)}（续）`;
      }
      const groupStart = Number(group.segments[0].order);
      const groupEnd = Number(group.segments.at(-1)?.order);
      const rangeChanged = groupStart !== Number(original.start_segment_order || groupStart) || groupEnd !== Number(original.end_segment_order || groupEnd);
      if (rangeChanged) {
        shot = cleanGenerated(shot);
        shot.storyboard_note = '';
        shot.source_evidence = '';
        shot.authoring = 'manual_range_pending';
      }
    }
    const participants = [...new Set(group.segments.map(segment => String(segment.speaker_id || '')).filter(Boolean))];
    shot.participants = participants;
    shot.start_segment_order = Number(group.segments[0].order);
    shot.end_segment_order = Number(group.segments.at(-1)?.order);
    applyShotSource(shot, group.segments);
    if (group.sourceId === manualId || count > 0) {
      delete shot.start_seconds;
      delete shot.end_seconds;
    }
    return shot;
  });
  scenes[sceneIndex] = { ...scene, shots: rebuilt };
  document.scenes = scenes;
  document.segments = segments;
  document.storyboard_authoring = { mode: 'manual_shot', scene_id: sceneId, shot_id: manualId, start_segment_order: start, end_segment_order: end };
  return { document, sceneId, shotId: manualId };
}

export const createManualStoryboardScene = createManualStoryboardShot;

export function splitStoryboardShot(sourceDocument: Record<string, unknown>, sceneId: string, shotId: string): StoryboardEditResult {
  const { document, segments, scenes } = documentParts(sourceDocument);
  const sceneIndex = scenes.findIndex(scene => String(scene.id || '') === sceneId);
  if (sceneIndex < 0) throw new Error('场景不存在');
  const scene = scenes[sceneIndex];
  const shots = (Array.isArray(scene.shots) ? scene.shots : []) as Array<Record<string, unknown>>;
  const shotIndex = shots.findIndex(shot => String(shot.id || '') === shotId);
  if (shotIndex < 0) throw new Error('分镜镜头不存在');
  const shot = shots[shotIndex];
  const start = Number(shot.start_segment_order || 0);
  const end = Number(shot.end_segment_order || start);
  if (end <= start) throw new Error('该镜头只有一条分句，请先在分句导演中拆分分句');
  const splitAfter = Math.floor((start + end) / 2);
  const used = new Set(shots.map(item => String(item.id || '')).filter(Boolean));
  const newId = nextId(`${sceneId}_split`, used);
  const leftSegments = segments.filter(segment => Number(segment.order) >= start && Number(segment.order) <= splitAfter);
  const rightSegments = segments.filter(segment => Number(segment.order) > splitAfter && Number(segment.order) <= end);
  const left = cleanGenerated({ ...shot, start_segment_order: start, end_segment_order: splitAfter, title: `${String(shot.title || shotId)} A`, storyboard_note: '', source_evidence: '', authoring: 'manual_split_pending' });
  const right = cleanGenerated({ ...shot, id: newId, start_segment_order: splitAfter + 1, end_segment_order: end, title: `${String(shot.title || shotId)} B`, storyboard_note: '', source_evidence: '', authoring: 'manual_split_pending' });
  applyShotSource(left, leftSegments);
  applyShotSource(right, rightSegments);
  if (Number.isFinite(Number(shot.start_seconds)) && Number.isFinite(Number(shot.end_seconds))) {
    const ratio = (splitAfter - start + 1) / (end - start + 1);
    const splitSeconds = Number(shot.start_seconds) + (Number(shot.end_seconds) - Number(shot.start_seconds)) * ratio;
    left.start_seconds = Number(shot.start_seconds); left.end_seconds = splitSeconds;
    right.start_seconds = splitSeconds; right.end_seconds = Number(shot.end_seconds);
  }
  scenes[sceneIndex] = { ...scene, shots: [...shots.slice(0, shotIndex), left, right, ...shots.slice(shotIndex + 1)] };
  document.scenes = scenes;
  return { document, sceneId, shotId: newId };
}

export function mergeStoryboardShots(sourceDocument: Record<string, unknown>, sceneId: string, shotIds: string[]): StoryboardEditResult {
  const { document, segments, scenes } = documentParts(sourceDocument);
  const sceneIndex = scenes.findIndex(scene => String(scene.id || '') === sceneId);
  if (sceneIndex < 0) throw new Error('场景不存在');
  const scene = scenes[sceneIndex];
  const shots = (Array.isArray(scene.shots) ? scene.shots : []) as Array<Record<string, unknown>>;
  const selected = [...new Set(shotIds)];
  if (selected.length < 2) throw new Error('请至少选择两个相邻分镜镜头');
  const indexes = selected.map(id => shots.findIndex(shot => String(shot.id || '') === id)).sort((a, b) => a - b);
  if (indexes.some(index => index < 0) || indexes.some((index, offset) => offset > 0 && index !== indexes[offset - 1] + 1)) throw new Error('只能合并同一场景内相邻的分镜镜头');
  const mergeRows = shots.slice(indexes[0], indexes.at(-1)! + 1);
  const first = mergeRows[0];
  const merged = cleanGenerated({
    ...first,
    title: `${String(first.title || first.id)}（合并）`,
    storyboard_note: [...new Set(mergeRows.map(shot => String(shot.storyboard_note || '').trim()).filter(Boolean))].join(' '),
    participants: [...new Set(mergeRows.flatMap(shot => Array.isArray(shot.participants) ? shot.participants.map(String) : []))],
    start_segment_order: Number(first.start_segment_order),
    end_segment_order: Number(mergeRows.at(-1)?.end_segment_order),
    authoring: 'manual_merge',
  });
  const mergedSegments = segments.filter(segment => Number(segment.order) >= Number(first.start_segment_order) && Number(segment.order) <= Number(mergeRows.at(-1)?.end_segment_order));
  applyShotSource(merged, mergedSegments);
  merged.source_evidence = [...new Set(mergeRows.map(shot => String(shot.source_evidence || '').trim()).filter(Boolean))].join('；');
  const timed = mergeRows.every(shot => Number.isFinite(Number(shot.start_seconds)) && Number.isFinite(Number(shot.end_seconds)));
  if (timed) {
    merged.start_seconds = Number(first.start_seconds);
    merged.end_seconds = Number(mergeRows.at(-1)?.end_seconds);
  }
  const rebuilt = [...shots.slice(0, indexes[0]), merged, ...shots.slice(indexes.at(-1)! + 1)];
  scenes[sceneIndex] = { ...scene, shots: rebuilt };
  document.scenes = scenes;
  return { document, sceneId, shotId: String(merged.id) };
}
