import { parseBody, withApiContext } from '@/server/api/handler';
import { sendEmail } from '@/server/email/service';
import { sendEmailSchema } from '@/server/email/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/email/send
 * Compose + send workflow (PDF #10 §6):
 *  - recipient validation
 *  - optional template selection with variable substitution
 *  - preview is available via /templates/[id]/preview before calling this route
 *  - client association where appropriate
 *  - stores provider message id, status, failure reason, idempotencyKey, audit
 *
 * The email provider is called server-side only. API keys never reach the browser.
 * Retry with the same idempotencyKey returns the existing record without duplicating.
 */
export const POST = withApiContext(async ({ actor, repo }, request) => {
  const body = await parseBody(request, sendEmailSchema);
  if (!body.ok) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'INVALID_INPUT',
        message: body.message,
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  // Honest handling for malformed direct fields that contain stray {{ without variables
  const result = await sendEmail(actor, repo, body.data);
  if (!result.ok) {
    const status =
      result.error.errorClass === 'permission'
        ? 403
        : result.error.errorClass === 'not_configured'
          ? 503
          : result.error.errorClass === 'validation'
            ? 400
            : 500;
    return { ok: false as const, status, error: result.error };
  }
  return { ok: true as const, data: result.data, status: 201 };
});
