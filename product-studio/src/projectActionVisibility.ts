export function isProjectWorkspaceVisible(entry: Pick<IntersectionObserverEntry, 'isIntersecting' | 'intersectionRatio'>) {
  return entry.isIntersecting && entry.intersectionRatio > 0;
}
