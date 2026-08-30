export type ProjectSwitchState =
  | { phase: 'idle' }
  | { phase: 'loading'; sequence: number; targetId: string; targetLabel: string }
  | { phase: 'error'; sequence: number; targetId: string; targetLabel: string; message: string };

export function beginProjectSwitch(sequence: number, targetId: string, targetLabel: string): ProjectSwitchState {
  return { phase: 'loading', sequence, targetId, targetLabel };
}

export function isCurrentProjectSwitch(state: ProjectSwitchState, sequence: number, targetId: string) {
  return state.phase === 'loading' && state.sequence === sequence && state.targetId === targetId;
}

export function failProjectSwitch(state: ProjectSwitchState, sequence: number, targetId: string, message: string): ProjectSwitchState {
  if (state.phase !== 'loading' || state.sequence !== sequence || state.targetId !== targetId) return state;
  return { phase: 'error', sequence, targetId, targetLabel: state.targetLabel, message };
}
