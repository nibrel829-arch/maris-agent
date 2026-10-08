import { parseBody, withApiContext } from '@/server/api/handler';
import { resubscribeEmail, unsubscribeEmail } from '@/server/email/sequence-service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().trim().email().max(254),
  action: z.enum(['unsubscribe', 'resubscribe']),
});

export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, schema);
  if (!body.ok) {
    return { ok: false as const, status: 400, error: { code: 'INVALID_INPUT', message: body.message, severity: 'error' as const, retryable: false, errorClass: 'validation' as const } };
  }
  const result =
    body.data.action === 'unsubscribe'
      ? await unsubscribeEmail(actor, repo, body.data.email)
      : await resubscribeEmail(actor, repo, body.data.email);
  if (!result.ok) {
    const status = result.error.errorClass === 'permission' ? 403 : 400;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data };
});

export const GET = withApiContext(async ({ actor, repo }) => {
  const list = await repo.emailPreferences.list(actor.organizationId, { limit: 200 });
  // only show opted_out true? Return all for admin debugging but redact?
  return { ok: true as const, data: { preferences: list } };
});
