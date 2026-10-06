import { z } from 'zod';
import { parseBody, withApiContext } from '@/server/api/handler';
import { checkPermission } from '@/server/auth/permissions';
import type { ClientStatus } from '@/types/domain';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  email: z.string().email().optional(),
  status: z.enum(['lead', 'qualified', 'active', 'paused', 'churned']).default('lead'),
  tags: z.array(z.string().max(50)).max(25).default([]),
});

export const GET = withApiContext(async ({ actor, repo }) => {
  const permission = checkPermission(actor, { module: 'clients', action: 'view' });
  if (!permission.allowed) {
    return {
      ok: false as const,
      status: 403,
      error: {
        code: 'PERMISSION_DENIED',
        message: permission.reason,
        severity: 'error',
        retryable: false,
        errorClass: 'permission',
      },
    };
  }
  return { ok: true as const, data: await repo.clients.list(actor.organizationId, { limit: 100 }) };
});

export const POST = withApiContext(async ({ actor, repo }, request) => {
  const permission = checkPermission(actor, { module: 'clients', action: 'create' });
  if (!permission.allowed) {
    return {
      ok: false as const,
      status: 403,
      error: {
        code: 'PERMISSION_DENIED',
        message: permission.reason,
        severity: 'error',
        retryable: false,
        errorClass: 'permission',
      },
    };
  }

  const body = await parseBody(request, createSchema);
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

  const client = await repo.clients.insert({
    organization_id: actor.organizationId,
    name: body.data.name,
    company: body.data.company ?? null,
    email: body.data.email ?? null,
    status: body.data.status as ClientStatus,
    tags: body.data.tags,
    notes: null,
    created_by: actor.userId,
  });

  return { ok: true as const, data: client, status: 201 };
});
