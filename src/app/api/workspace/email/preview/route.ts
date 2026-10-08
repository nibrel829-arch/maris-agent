import { parseBody, withApiContext } from '@/server/api/handler';
import { renderTemplate, malformedPlaceholderError } from '@/server/email/validation';
import { checkPermission } from '@/server/auth/permissions';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const previewSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
  variables: z.record(z.string(), z.string()).default({}),
});

/**
 * POST /api/workspace/email/preview
 * Generic preview: renders subject/body with variables without persisting or sending.
 * Useful for the compose step before calling /send.
 */
export const POST = withApiContext(async ({ actor }, request) => {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return {
      ok: false as const,
      status: 403,
      error: {
        code: 'PERMISSION_DENIED',
        message: `Role "${actor.role}" does not have "view" permission on module "email".`,
        severity: 'error' as const,
        retryable: false,
        errorClass: 'permission' as const,
      },
    };
  }

  const body = await parseBody(request, previewSchema);
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

  const subjErr = malformedPlaceholderError(body.data.subject);
  if (subjErr) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'TEMPLATE_MALFORMED',
        message: subjErr,
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }
  const bodyErr = malformedPlaceholderError(body.data.body);
  if (bodyErr) {
    return {
      ok: false as const,
      status: 400,
      error: {
        code: 'TEMPLATE_MALFORMED',
        message: bodyErr,
        severity: 'error' as const,
        retryable: false,
        errorClass: 'validation' as const,
      },
    };
  }

  const subject = renderTemplate(body.data.subject, body.data.variables);
  const renderedBody = renderTemplate(body.data.body, body.data.variables);

  return {
    ok: true as const,
    data: {
      subject: subject.rendered,
      body: renderedBody.rendered,
      unresolved: [...new Set([...subject.unresolved, ...renderedBody.unresolved])].sort(),
    },
  };
});
