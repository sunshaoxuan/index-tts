export type ProjectActionDisplayEvent = 'manual-expand' | 'manual-collapse' | 'idle-timeout';

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

export function projectActionAvailability(activeTab: string, input: ProjectActionAvailabilityInput) {
  return {
    settings: true,
    save: !input.jobRunning && input.dirty,
    analyze: activeTab === 'source' && !input.jobRunning && input.hasSource,
    voice: activeTab === 'roles' && !input.jobRunning && input.hasRoles,
    render: activeTab === 'delivery' && !input.jobRunning && input.hasSegments,
  };
}
