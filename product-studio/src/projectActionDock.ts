export type ProjectActionDockEdge = 'top' | 'right' | 'bottom' | 'left';

export type ProjectActionDockPlacement = {
  edge: ProjectActionDockEdge;
  offset: number;
};

const DOCK_EDGES: ProjectActionDockEdge[] = ['top', 'right', 'bottom', 'left'];

export function nearestProjectActionDockEdge(pointerX: number, pointerY: number, viewportWidth: number, viewportHeight: number): ProjectActionDockEdge {
  const distances: Array<[ProjectActionDockEdge, number]> = [
    ['top', pointerY],
    ['right', viewportWidth - pointerX],
    ['bottom', viewportHeight - pointerY],
    ['left', pointerX],
  ];
  return distances.reduce((nearest, candidate) => candidate[1] < nearest[1] ? candidate : nearest)[0];
}

export function projectActionDockOffset(edge: ProjectActionDockEdge, pointerX: number, pointerY: number) {
  return edge === 'left' || edge === 'right' ? pointerY : pointerX;
}

export function clampProjectActionDockPlacement(
  placement: ProjectActionDockPlacement,
  viewportWidth: number,
  viewportHeight: number,
  dockWidth: number,
  dockHeight: number,
  gap = 8,
): ProjectActionDockPlacement {
  const vertical = placement.edge === 'left' || placement.edge === 'right';
  const viewportSize = vertical ? viewportHeight : viewportWidth;
  const dockSize = vertical ? dockHeight : dockWidth;
  const minimum = Math.min(viewportSize / 2, dockSize / 2 + gap);
  const maximum = Math.max(minimum, viewportSize - dockSize / 2 - gap);
  return { edge: placement.edge, offset: Math.min(maximum, Math.max(minimum, placement.offset)) };
}

export function normalizeProjectActionDockPlacement(value: unknown, viewportWidth: number, viewportHeight: number): ProjectActionDockPlacement {
  if (value && typeof value === 'object') {
    const candidate = value as { edge?: unknown; offset?: unknown };
    if (DOCK_EDGES.includes(candidate.edge as ProjectActionDockEdge) && typeof candidate.offset === 'number' && Number.isFinite(candidate.offset)) {
      return { edge: candidate.edge as ProjectActionDockEdge, offset: Number(candidate.offset) };
    }
  }
  return { edge: 'right', offset: viewportHeight / 2 };
}
