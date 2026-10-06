/**
 * Audit Logger (PDF #05 §9, PDF #08 §3, PDF #12 §17).
 *
 * Important actions are recorded with actor, organization, entity and
 * structured metadata. Audit failures never mask the underlying operation
 * result; they are reported alongside it.
 */

import type { ActivityAction, ActorContext, UUID } from '@/types/domain';
import type { NibrexoRepository } from '@/server/db/types';
import type { ManagerIssue } from '@/types/manager';

export interface AuditEntry {
  action: ActivityAction | string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(
  repo: NibrexoRepository,
  actor: ActorContext,
  entry: AuditEntry,
): Promise<ManagerIssue | null> {
  try {
    await repo.activityLogs.insert({
      organization_id: actor.organizationId,
      actor_id: actor.userId,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    } as never);
    return null;
  } catch (error) {
    return {
      code: 'AUDIT_WRITE_FAILED',
      message: error instanceof Error ? error.message : 'Audit write failed.',
      severity: 'warning',
      retryable: true,
      errorClass: 'server',
    };
  }
}

export async function logTaskEvent(
  repo: NibrexoRepository,
  actor: ActorContext,
  taskId: UUID,
  action: ActivityAction,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await writeAudit(repo, actor, {
    action,
    entityType: 'manager_task',
    entityId: taskId,
    metadata,
  });
}
