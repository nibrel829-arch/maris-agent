import { parseBody, withApiContext } from '@/server/api/handler';
import { resolveRequestOrigin } from '@/server/email/asset-url';
import { sendDesignTestEmail } from '@/server/email/design-service';
import { testSendSchema } from '@/server/email/design-validation';
import { invalidStudioInput, studioFailure } from '../../../_shared';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/workspace/email/designs/:id/test-send
 *
 * Sends ONE test message through the existing provider adapter (Resend when
 * configured, otherwise an honest `not_configured` failure). Requirements:
 *  - `email:send` permission (owner/admin),
 *  - a design with no blocking validation issues,
 *  - the subject is prefixed with `[Test]` so it can never be mistaken for a
 *    campaign send,
 *  - the send is idempotent per (design, recipient) and is recorded in
 *    `email_logs` with the real provider outcome.
 *
 * This route never sends a campaign: campaigns keep their own approval gates.
 */
export const POST = withApiContext(async ({ actor, repo }, request, extra: RouteParams) => {
  const { id } = await extra.params;
  const body = await parseBody(request, testSendSchema);
  if (!body.ok) return invalidStudioInput(body.message);

  const result = await sendDesignTestEmail(actor, repo, id, body.data, {
    baseUrl: resolveRequestOrigin(request),
  });
  if (!result.ok) return studioFailure(result.error);
  return { ok: true as const, data: result.data, status: 201 };
});
