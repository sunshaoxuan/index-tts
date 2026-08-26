export type WheelAxis = 'horizontal' | 'vertical';

export function dominantWheelAxis(deltaX: number, deltaY: number): WheelAxis {
  return Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
}

export function shouldPreventScrollChain(delta: number, position: number, maximum: number): boolean {
  if (!delta) return false;
  if (delta < 0) return position <= 0;
  return position >= Math.max(0, maximum) - 1;
}
