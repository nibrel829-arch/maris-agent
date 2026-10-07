import { parseBody, withApiContext } from '@/server/api/handler';
import { previewTemplate } from '@/server/email/service';
import { previewTemplateSchema } from '@/server/email/validation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspace/email/templates/[id]/preview
 * Renders the template with supplied variables and reports unresolved placeholders.
 * No email is sent. Variables are not persisted.
 */
export const POST = withApiContext(async ({ actor, repo }, request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await parseBody(request, previewTemplateSchema);
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

  const result = await previewTemplate(actor, repo, id, body.data);
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.error.code === 'TEMPLATE_NOT_FOUND' ? 404 : result.error.errorClass === 'permission' ? 403 : 500,
      error: result.error,
    };
  }
  return { ok: true as const, data: result.data };
});
