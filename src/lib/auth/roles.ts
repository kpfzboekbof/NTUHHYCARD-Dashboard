/**
 * Roles, with no Node dependencies, so the people page can import them.
 *
 * `session.ts` needs `node:crypto`; pulling the role list out keeps a client
 * component from dragging the signing code into the browser bundle.
 */

export type Role = 'manager' | 'doctor' | 'abstractor' | 'labeler' | 'viewer';

export const ALL_ROLES: Role[] = ['manager', 'doctor', 'abstractor', 'labeler', 'viewer'];

export const ROLE_LABELS: Record<Role, string> = {
  manager: '管理者',
  doctor: '醫師',
  abstractor: '助理',
  labeler: 'Labeler',
  viewer: '檢視',
};

/**
 * Whether a set of roles is enough for what a route asks.
 *
 * `manager` is the superset by definition (§3.3), and anyone signed in can do
 * what a viewer can — otherwise the role has to be held outright. Keeping this
 * in one function is the point: the old code asked "is the admin cookie
 * present" in five places, which is not a role model, only a repeated if.
 */
export function satisfiesRole(roles: Role[], required: Role): boolean {
  if (roles.includes('manager')) return true;
  if (required === 'viewer') return roles.length > 0;
  return roles.includes(required);
}
