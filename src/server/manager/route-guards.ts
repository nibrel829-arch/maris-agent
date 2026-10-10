/**
 * Route-level authorization for the Manager API (Phase 17).
 *
 * `withApiContext` resolves the actor; it does not authorize. Every Manager
 * route therefore names the permission it needs. Reads need `ai:view`; creating
 * tasks, answering questions and resuming need `ai:create`.
 */
import type { ManagerIssue } from '@/types/manager';
import { checkPermission } from '@/server/auth/permissions';
import type { ActorContext } from '@/types/domain';

export interface PermissionFailure {
  ok: false;
  status: 403;
  error: ManagerIssue;
}

export function requireAi(actor: ActorContext, action: 'view' | 'create'): PermissionFailure | null {
  const decision = checkPermission(actor, { module: 'ai', action });
  if (decision.allowed) return null;
  return {
    ok: false,
    status: 403,
    error: {
      code: 'PERMISSION_DENIED',
      message:
        action === 'create'
          ? 'Your role cannot start or continue Manager work.'
          : 'Your role cannot view Manager work.',
      severity: 'error',
      retryable: false,
      errorClass: 'permission',
    },
  };
}
