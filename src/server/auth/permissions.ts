/**
 * Permission Guard (PDF #08 §7).
 *
 * Checks run BEFORE tool execution and are authoritative. Frontend visibility
 * is a UX concern, never a security boundary.
 *
 *   AGENT WANTS ACTION -> IDENTIFY USER -> IDENTIFY ORGANIZATION -> CHECK ROLE
 *   -> CHECK MODULE PERMISSION -> CHECK RESOURCE ACCESS -> ALLOW / DENY
 */

import permissionsConfig from '@/config/permissions.json';
import type { ActorContext, OrgRole } from '@/types/domain';
import type { ModuleId, ToolPermission } from '@/types/manager';

type ActionMatrix = Partial<Record<ModuleId, string[]>>;

interface PermissionsConfig {
  version: string;
  roles: Record<OrgRole, { label: string; description: string; modules: ActionMatrix }>;
}

const config = permissionsConfig as unknown as PermissionsConfig;

export const ORG_ROLES: readonly OrgRole[] = ['owner', 'admin', 'member', 'client'];

export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'publish',
  'send',
  'approve',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
  role: OrgRole;
  module: ModuleId;
  action: PermissionAction;
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value);
}

export function isModuleId(value: unknown): value is ModuleId {
  return (
    typeof value === 'string' &&
    ['dashboard', 'social', 'content', 'inbox', 'clients', 'email', 'ai', 'settings'].includes(
      value,
    )
  );
}

export function isPermissionAction(value: unknown): value is PermissionAction {
  return typeof value === 'string' && (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

export function roleLabel(role: OrgRole): string {
  return config.roles[role]?.label ?? role;
}

/** Permissions granted to a role for one module. */
export function actionsFor(role: OrgRole, module: ModuleId): readonly PermissionAction[] {
  const modules = config.roles[role]?.modules ?? {};
  const actions = modules[module] ?? [];
  return actions.filter(isPermissionAction);
}

/**
 * Core check. `organizationId` is required: a tool may only act inside the
 * organization the actor belongs to (PDF #12 §15, PDF #11 §5).
 */
export function checkPermission(
  actor: ActorContext,
  permission: ToolPermission,
  organizationId?: string,
): PermissionDecision {
  const { role, module, action } = { role: actor.role, ...permission };

  if (organizationId && organizationId !== actor.organizationId) {
    return {
      allowed: false,
      reason: 'Cross-organization access is denied.',
      role,
      module,
      action,
    };
  }

  const granted = actionsFor(role, module);
  if (!granted.includes(action)) {
    return {
      allowed: false,
      reason: `Role "${roleLabel(role)}" does not have "${action}" permission on module "${module}".`,
      role,
      module,
      action,
    };
  }

  return { allowed: true, reason: 'Allowed by role permission matrix.', role, module, action };
}

/** Convenience wrapper used by tools and services. */
export function requirePermission(
  actor: ActorContext,
  permission: ToolPermission,
  organizationId?: string,
): PermissionDecision {
  return checkPermission(actor, permission, organizationId);
}
