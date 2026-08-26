import type { RoleRow } from './types';

export function normalizeActiveRoleId(roles: RoleRow[], candidate?: string): string | undefined {
  if (candidate && roles.some(row => row[0] === candidate)) return candidate;
  return roles[0]?.[0];
}

export function roleRowClassName(roleId: string, activeRoleId?: string): string {
  return roleId === activeRoleId ? 'role-focus-row role-focus-row-active' : 'role-focus-row';
}
