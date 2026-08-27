export function isProjectWorkspaceVisible(rect: Pick<DOMRect, 'top' | 'bottom'>, viewportHeight: number) {
  return rect.bottom > 0 && rect.top < viewportHeight;
}
