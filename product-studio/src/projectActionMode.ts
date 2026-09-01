export type ProjectActionDisplayEvent = 'manual-expand' | 'manual-collapse' | 'idle-timeout';
export type ProjectGenerationAction = 'analyze' | 'voice' | 'render';

export type ProjectActionAvailabilityInput = {
  jobRunning: boolean;
  dirty: boolean;
  hasSource: boolean;
  hasRoles: boolean;
  hasSegments: boolean;
};

export function nextProjectActionDisplay(expanded: boolean, event: ProjectActionDisplayEvent) {
  if (event === 'manual-expand') return true;
  if (event === 'manual-collapse' || event === 'idle-timeout') return false;
  return expanded;
}

export function projectActionAvailability(input: ProjectActionAvailabilityInput) {
  return {
    settings: true,
    save: !input.jobRunning && input.dirty,
    analyze: !input.jobRunning && input.hasSource,
    voice: !input.jobRunning && input.hasRoles,
    render: !input.jobRunning && input.hasSegments,
  };
}

export function projectActionTargetWorkspace(action: ProjectGenerationAction) {
  return { analyze: 'source', voice: 'roles', render: 'delivery' }[action];
}

export function projectActionDisabledReason(action: ProjectGenerationAction, input: ProjectActionAvailabilityInput) {
  if (input.jobRunning) return '当前有后台任务正在运行，请等待任务结束';
  if (action === 'analyze' && !input.hasSource) return '请先填写作品原文';
  if (action === 'voice' && !input.hasRoles) return '请先完成角色分析或建立角色';
  if (action === 'render' && !input.hasSegments) return '请先完成分句分析';
  return undefined;
}
