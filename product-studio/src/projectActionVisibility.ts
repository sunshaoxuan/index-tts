export function isProjectWorkspaceVisible(rect: Pick<DOMRect, 'top' | 'bottom'>, viewportHeight: number) {
  return rect.bottom > 0 && rect.top < viewportHeight;
}

export function nextProjectActionsExpanded(wasWorkspaceVisible: boolean, workspaceVisible: boolean, expanded: boolean) {
  if (workspaceVisible && !wasWorkspaceVisible) return true;
  if (!workspaceVisible && wasWorkspaceVisible) return false;
  return expanded;
}
