export type SegmentRegenerationState =
  | { phase: 'idle' }
  | { phase: 'saving' | 'submitting'; order: number };

export function beginSegmentRegeneration(order: number, hasUnsavedChanges: boolean): SegmentRegenerationState {
  return { phase: hasUnsavedChanges ? 'saving' : 'submitting', order };
}

export function submitSegmentRegeneration(order: number): SegmentRegenerationState {
  return { phase: 'submitting', order };
}

export function segmentRegenerationButtonLabel(state: SegmentRegenerationState) {
  if (state.phase === 'idle') return '';
  return state.phase === 'saving' ? `正在保存分句 ${state.order}…` : `正在提交分句 ${state.order}…`;
}

export function segmentRegenerationStatusMessage(state: SegmentRegenerationState) {
  if (state.phase === 'idle') return '';
  return state.phase === 'saving'
    ? `正在保存当前工程，随后生成分句 ${state.order}`
    : `正在向服务器提交分句 ${state.order} 的生成请求`;
}
