import { withApiContext } from '@/server/api/handler';
import { STARTER_TEMPLATES, starterVariables } from '@/server/email/starter-templates';
import { checkPermission } from '@/server/auth/permissions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/workspace/email/starters
 *
 * The polished starter designs (welcome, newsletter, product launch,
 * promotional campaign, announcement, client update). Each entry is a complete,
 * editable design document — not a screenshot — plus the variable names it
 * references so the studio can pre-fill the preview panel.
 */
export const GET = withApiContext(async ({ actor }) => {
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

  return {
    ok: true as const,
    data: {
      starters: STARTER_TEMPLATES.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        subject: template.subject,
        design: template.design,
        variables: starterVariables(template),
        blocks: template.design.blocks.length,
      })),
    },
  };
});
