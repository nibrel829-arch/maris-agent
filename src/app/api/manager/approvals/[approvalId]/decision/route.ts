import { z } from 'zod';
import { parseBody, withApiContext } from '@/server/api/handler';
import { isExpired } from '@/server/manager/approval-policy';
import { actionsFor } from '@/server/auth/permissions';
import { writeAudit } from '@/server/manager/audit';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ approvalId: string }>;
}

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(1000).optional(),
});

/**
 * POST /api/manager/approvals/:approvalId/decision
 *
 * Deciding an approval is an elevated action: only owner/admin may do it
 * (PDF #04 §3, PDF #12 §15). Expired approvals cannot be reused (PDF #08 §8).
 */
export const POST = withApiContext(async ({ actor, repo }, request, extra) => {
  const { approvalId } = await (extra as RouteParams).params;

  if (!actionsFor(actor.role, 'settings').includes('edit')) {
    return {
      ok: false as const,
      status: 403,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Only an owner or admin can approve or reject an action.',
        severity: 'error',
        retryable: false,
        errorClass: 'permission',
      },
    };
  }

  const body = await parseBody(request, decisionSchema);
  if (!body.ok) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: body.message,
        severity: 'error',
        retryable: false,
        errorClass: 'validation',
      },
    };
  }

  const approval = await repo.approvals.get(approvalId, actor.organizationId);
  if (!approval) {
    return {
      ok: false as const,
      status: 404,
      error: {
        code: 'NOT_FOUND',
        message: 'Approval not found.',
        severity: 'warning',
        retryable: false,
        errorClass: 'validation',
      },
    };
  }

  if (approval.status !== 'pending') {
    return {
      ok: false as const,
      status: 409,
      error: {
        code: 'APPROVAL_ALREADY_DECIDED',
        message: `This approval is already ${approval.status}.`,
        severity: 'warning',
        retryable: false,
        errorClass: 'validation',
      },
    };
  }

  if (isExpired(approval.expires_at)) {
    await repo.approvals.update(approvalId, actor.organizationId, {
      status: 'expired',
    } as never);
    return {
      ok: false as const,
      status: 410,
      error: {
        code: 'APPROVAL_EXPIRED',
        message: 'This approval expired. Expired approvals cannot be reused.',
        severity: 'warning',
        retryable: false,
        errorClass: 'permission',
      },
    };
  }

  const updated = await repo.approvals.update(approvalId, actor.organizationId, {
    status: body.data.decision,
    decided_by: actor.userId,
    decided_at: new Date().toISOString(),
    decision_note: body.data.note ?? null,
  } as never);

  await writeAudit(repo, actor, {
    action: 'manager.approval.decided',
    entityType: 'approval',
    entityId: approvalId,
    metadata: { decision: body.data.decision, tool: approval.tool_name, taskId: approval.task_id },
  });

  return { ok: true as const, data: updated };
});
