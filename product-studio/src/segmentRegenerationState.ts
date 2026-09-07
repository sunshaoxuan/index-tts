export type SegmentRegenerationState =
  | { phase: 'idle' }
  | { phase: 'saving' | 'submitting' | 'running'; order: number };

export function beginSegmentRegeneration(order: number, hasUnsavedChanges: boolean): SegmentRegenerationState {
  return { phase: hasUnsavedChanges ? 'saving' : 'submitting', order };
}

export function submitSegmentRegeneration(order: number): SegmentRegenerationState {
  return { phase: 'submitting', order };
}

export function runSegmentRegeneration(order: number): SegmentRegenerationState {
  return { phase: 'running', order };
}

export function segmentRowEditorLocked(jobRunning: boolean, state: SegmentRegenerationState, order: number) {
  if (state.phase === 'idle') return jobRunning;
  return state.order === order;
}

export function segmentRegenerationButtonLabel(state: SegmentRegenerationState) {
  if (state.phase === 'idle') return '';
  if (state.phase === 'saving') return `正在保存分句 ${state.order}…`;
  return state.phase === 'submitting' ? `正在提交分句 ${state.order}…` : `正在生成分句 ${state.order}…`;
}

export function segmentRegenerationStatusMessage(state: SegmentRegenerationState) {
  if (state.phase === 'idle') return '';
  if (state.phase === 'saving') return `正在保存当前工程，随后生成分句 ${state.order}`;
  return state.phase === 'submitting'
    ? `正在向服务器提交分句 ${state.order} 的生成请求`
    : `分句 ${state.order} 正在后台生成，其他分句仍可编辑`;
}
