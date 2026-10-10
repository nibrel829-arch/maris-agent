/**
 * Email and external communication tools (PDF #10, PDF #08 §6 Email group).
 *
 * Drafting and personalization are internal preparation. `send_email` is an
 * external, high-risk action: it is declared `external: true`, requires
 * approval, and only executes through a configured provider adapter.
 */

import { z } from 'zod';
import { createEmailProvider } from '@/server/integrations/email/provider';
import type { EmailStatus } from '@/types/domain';
import {
  createDesign,
  listDesigns,
  promoteDesignToTemplate,
  renderDesign,
  renderDesignDocument,
  updateDesign,
} from '@/server/email/design-service';
import { STARTER_TEMPLATES, getStarterTemplate, starterVariables } from '@/server/email/starter-templates';
import { defineTool } from './define';

const TEMPLATE_VARIABLE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VARIABLE)].map((match) => match[1] ?? ''))].filter(
    Boolean,
  );
}

export function renderTemplate(
  template: string,
  values: Record<string, string>,
): { rendered: string; unresolved: string[] } {
  const unresolved = new Set<string>();
  const rendered = template.replace(TEMPLATE_VARIABLE, (whole, key: string) => {
    if (key in values) return values[key] as string;
    unresolved.add(key);
    return whole;
  });
  return { rendered, unresolved: [...unresolved] };
}

export const createEmailTemplateTool = defineTool({
  name: 'create_email_template',
  description: 'Create an organization-scoped email template with validated variables.',
  permission: { module: 'email', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    category: z.string().min(1).max(80),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
  }),
  async execute(input, ctx) {
    const variables = [
      ...new Set([...extractVariables(input.subject), ...extractVariables(input.body)]),
    ];
    const template = await ctx.repo.emailTemplates.insert({
      organization_id: ctx.organizationId,
      name: input.name,
      category: input.category,
      subject: input.subject,
      body: input.body,
      variables,
      archived: false,
    });
    return { template, variables };
  },
});

export const listEmailTemplatesTool = defineTool({
  name: 'list_email_templates',
  description: 'List active email templates.',
  permission: { module: 'email', action: 'view' },
  risk: 'low',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(50),
    includeArchived: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    const templates = await ctx.repo.emailTemplates.list(ctx.organizationId, {
      limit: input.limit,
    });
    return templates.filter((template) => (input.includeArchived ? true : !template.archived));
  },
});

export const prepareEmailTool = defineTool({
  name: 'prepare_email',
  description:
    'Personalize a template for a recipient and store it as a draft. Preparation is not sending — the record stays in DRAFT until an approved send executes (CEO spec §9).',
  permission: { module: 'email', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    toEmail: z.string().email(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
    clientId: z.string().uuid().optional(),
    templateId: z.string().uuid().optional(),
  }),
  async execute(input, ctx) {
    const unresolved = [
      ...new Set([...extractVariables(input.subject), ...extractVariables(input.body)]),
    ];

    const log = await ctx.repo.emailLogs.insert({
      organization_id: ctx.organizationId,
      client_id: input.clientId ?? null,
      template_id: input.templateId ?? null,
      to_email: input.toEmail,
      subject: input.subject,
      body: input.body,
      status: 'DRAFT' as EmailStatus,
      provider_message_id: null,
      error_message: null,
      created_by: ctx.actor.userId,
    });

    return {
      emailLog: log,
      unresolvedVariables: unresolved,
      status: 'DRAFT' as const,
      note: 'Prepared, not sent. Sending requires approval and a configured provider.',
    };
  },
});

export const createEmailSequenceTool = defineTool({
  name: 'create_email_sequence',
  description: 'Create a follow-up sequence with delays and stop conditions (PDF #10 §9-§11).',
  permission: { module: 'email', action: 'create' },
  risk: 'medium',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    trigger: z.string().min(1).max(200),
    steps: z
      .array(
        z.object({
          delayDays: z.number().int().min(0).max(365),
          templateId: z.string().uuid().nullable().default(null),
          subject: z.string().min(1).max(300),
        }),
      )
      .min(1)
      .max(20),
    stopConditions: z.array(z.string().max(300)).max(15).default([]),
  }),
  async execute(input, ctx) {
    const sequence = await ctx.repo.emailSequences.insert({
      organization_id: ctx.organizationId,
      name: input.name,
      trigger: input.trigger,
      steps: input.steps.map((step, index) => ({
        id: `step-${index + 1}`,
        delayDays: step.delayDays,
        templateId: step.templateId,
        subject: step.subject,
      })),
      stop_conditions: [
        ...input.stopConditions,
        'Stop when the recipient replies.',
        'Stop when the recipient opts out.',
      ],
      status: 'draft',
      created_by: ctx.actor.userId,
    });
    return { sequence };
  },
});

export const sendEmailTool = defineTool({
  name: 'send_email',
  description:
    'EXTERNAL ACTION. Sends a prepared email through the configured provider adapter. Requires approval before execution. Reports not_configured when no provider is set up.',
  permission: { module: 'email', action: 'send' },
  risk: 'high',
  external: true,
  inputSchema: z.object({
    emailLogId: z.string().uuid(),
  }),
  async execute(input, ctx) {
    const log = await ctx.repo.emailLogs.get(input.emailLogId, ctx.organizationId);
    if (!log) throw new Error('Email record not found or not in this organization.');

    // Duplicate protection: an already-sent record must not be sent again.
    if (log.status === 'SENT' || log.status === 'DELIVERED') {
      return {
        status: 'skipped' as const,
        reason: 'This email was already sent. Duplicate sends are blocked.',
        emailLog: log,
      };
    }

    const unresolved = [
      ...new Set([...extractVariables(log.subject), ...extractVariables(log.body)]),
    ];
    if (unresolved.length > 0) {
      await ctx.repo.emailLogs.update(input.emailLogId, ctx.organizationId, {
        status: 'FAILED',
        error_message: `Unresolved template variables: ${unresolved.join(', ')}`,
      } as never);
      return {
        status: 'failed' as const,
        reason: `Unresolved template variables: ${unresolved.join(', ')}`,
        emailLog: await ctx.repo.emailLogs.get(input.emailLogId, ctx.organizationId),
      };
    }

    const provider = createEmailProvider();

    await ctx.repo.emailLogs.update(input.emailLogId, ctx.organizationId, {
      status: 'SENDING',
    } as never);

    const outcome = await provider.send({
      organizationId: ctx.organizationId,
      to: log.to_email,
      subject: log.subject,
      html: log.body,
      text: log.body.replace(/<[^>]+>/g, ''),
      idempotencyKey: ctx.idempotencyKey,
    });

    if (outcome.status === 'sent') {
      const updated = await ctx.repo.emailLogs.update(input.emailLogId, ctx.organizationId, {
        status: 'SENT',
        provider_message_id: outcome.providerMessageId,
        error_message: null,
      } as never);
      return {
        status: 'sent' as const,
        provider: outcome.provider,
        providerMessageId: outcome.providerMessageId,
        emailLog: updated,
      };
    }

    const updated = await ctx.repo.emailLogs.update(input.emailLogId, ctx.organizationId, {
      status: outcome.status === 'not_configured' ? 'DRAFT' : 'FAILED',
      error_message: outcome.reason,
    } as never);

    return {
      status: outcome.status,
      reason: outcome.reason,
      retryable: 'retryable' in outcome ? outcome.retryable : false,
      emailLog: updated,
    };
  },
});


/* -------------------------------------------------------------------------- */
/* Phase 16 — visual email design studio tools                                 */
/* -------------------------------------------------------------------------- */

/**
 * Unwraps a `ServiceResult` for the tool boundary. Tools throw, so a failed
 * service call surfaces as a structured Manager issue instead of a fabricated
 * success (PDF #08 §14).
 */
function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: { code: string; message: string; severity: 'info' | 'warning' | 'error'; retryable: boolean; errorClass: string } }): T {
  if (result.ok) return result.data;
  const error = new Error(`${result.error.code}: ${result.error.message}`);
  error.name = 'ToolError';
  throw error;
}

export const listEmailDesignStartersTool = defineTool({
  name: 'list_email_design_starters',
  description:
    'List the editable starter designs of the email studio (welcome, newsletter, product launch, promotional, announcement, client update). Use one as the base for create_email_design.',
  permission: { module: 'email', action: 'view' },
  risk: 'low',
  inputSchema: z.object({}),
  async execute(_input) {
    return STARTER_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      subject: template.subject,
      blocks: template.design.blocks.map((block) => block.type),
      variables: starterVariables(template),
    }));
  },
});

export const createEmailDesignTool = defineTool({
  name: 'create_email_design',
  description:
    'Create an editable visual email design (drag-and-drop studio) and save it as a draft. Provide a starterId to build on a polished starter, or an explicit design document. Nothing is sent and no template is activated.',
  permission: { module: 'email', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(80).default('general'),
    subject: z.string().min(1).max(300),
    starterId: z.string().max(80).optional(),
    design: z.unknown().optional(),
    status: z.enum(['draft', 'active']).optional(),
  }),
  async execute(input, ctx) {
    const starter = input.starterId ? getStarterTemplate(input.starterId) : undefined;
    if (input.starterId && !starter) {
      throw new Error(`Unknown starter design "${input.starterId}". Use list_email_design_starters to see the available ids.`);
    }
    if (!starter && input.design === undefined) {
      throw new Error('Provide either a starterId or an explicit design document.');
    }

    const baseDocument = starter ? starter.design : input.design;
    const created = await createDesign(
      ctx.actor,
      ctx.repo,
      {
        name: input.name,
        category: input.category,
        subject: input.subject,
        design: baseDocument,
        ...(input.status ? { status: input.status } : { status: 'draft' as const }),
        source: starter ? 'starter' : 'manager',
      } as Parameters<typeof createDesign>[2],
    );
    const design = unwrap(created);

    // Rendered without an asset base URL: the studio preview, the test send and
    // promotion all build signed asset URLs from the real request origin.
    const rendered = renderDesignDocument(ctx.organizationId, design.design, { baseUrl: null });

    return {
      design,
      blocks: design.design.blocks.map((block) => block.type),
      status: design.status,
      note:
        design.status === 'draft'
          ? 'Saved as a draft. It is not selectable for sending until it is promoted to an active template.'
          : 'Saved and active. Sending still requires email:send and the existing approval gates.',
      validation: rendered.validation,
    };
  },
});

export const listEmailDesignsTool = defineTool({
  name: 'list_email_designs',
  description: 'List the organization\'s saved email designs with their status, source and block counts.',
  permission: { module: 'email', action: 'view' },
  risk: 'low',
  inputSchema: z.object({
    status: z.enum(['draft', 'active', 'archived']).optional(),
    search: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  async execute(input, ctx) {
    const result = await listDesigns(ctx.actor, ctx.repo, {
      limit: input.limit,
      offset: 0,
      ...(input.status ? { status: input.status } : {}),
      ...(input.search ? { search: input.search } : {}),
    });
    const data = unwrap(result);
    return data.designs.map((design) => ({
      id: design.id,
      name: design.name,
      category: design.category,
      subject: design.subject,
      status: design.status,
      source: design.source,
      templateId: design.template_id,
      blocks: design.design.blocks.map((block) => block.type),
      updatedAt: design.updated_at,
    }));
  },
});

export const updateEmailDesignTool = defineTool({
  name: 'update_email_design',
  description:
    'Update a saved email design (name, category, subject, status or the design document itself). Designs stay editable drafts until they are promoted.',
  permission: { module: 'email', action: 'edit' },
  risk: 'low',
  inputSchema: z.object({
    designId: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    category: z.string().min(1).max(80).optional(),
    subject: z.string().min(1).max(300).optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    design: z.unknown().optional(),
  }),
  async execute(input, ctx) {
    const result = await updateDesign(ctx.actor, ctx.repo, input.designId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.design !== undefined ? { design: input.design } : {}),
    } as Parameters<typeof updateDesign>[3]);
    const design = unwrap(result);
    return { design, blocks: design.design.blocks.map((block) => block.type), status: design.status };
  },
});

export const renderEmailDesignTool = defineTool({
  name: 'render_email_design',
  description:
    'Render a saved email design to responsive table-based HTML, a plain-text alternative and a validation report. Inspection only — nothing is sent.',
  permission: { module: 'email', action: 'view' },
  risk: 'low',
  inputSchema: z.object({
    designId: z.string().uuid(),
    includeHtml: z.boolean().default(true),
    includeText: z.boolean().default(true),
  }),
  async execute(input, ctx) {
    const result = await renderDesign(ctx.actor, ctx.repo, input.designId, { baseUrl: null });
    const rendered = unwrap(result);
    return {
      designId: rendered.designId,
      designName: rendered.designName,
      status: rendered.status,
      subject: rendered.subject,
      preheader: rendered.preheader,
      unresolvedVariables: rendered.unresolvedVariables,
      validation: rendered.validation,
      ...(input.includeHtml ? { html: rendered.html } : {}),
      ...(input.includeText ? { text: rendered.text } : {}),
    };
  },
});

export const promoteEmailDesignTool = defineTool({
  name: 'promote_email_design',
  description:
    'Promote a studio design into the existing email_templates table so the composer, sequences and send pipeline can use it. The template is created as a draft unless an explicit status is given; sending still requires email:send and approval.',
  permission: { module: 'email', action: 'create' },
  risk: 'medium',
  inputSchema: z.object({
    designId: z.string().uuid(),
    name: z.string().max(100).optional(),
    category: z.string().max(80).optional(),
    status: z.enum(['draft', 'active']).optional(),
  }),
  async execute(input, ctx) {
    const result = await promoteDesignToTemplate(ctx.actor, ctx.repo, input.designId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    } as Parameters<typeof promoteDesignToTemplate>[3]);
    const { design, template } = unwrap(result);
    return {
      designId: design.id,
      designStatus: design.status,
      template: {
        id: template.id,
        name: template.name,
        category: template.category,
        status: template.status ?? (template.archived ? 'archived' : 'active'),
        bodyLength: template.body.length,
      },
      note:
        'The rendered design was written into the existing email_templates table. Promotion never activates a template for sending by itself.',
    };
  },
});

export const emailStudioTools = [
  listEmailDesignStartersTool,
  createEmailDesignTool,
  listEmailDesignsTool,
  updateEmailDesignTool,
  renderEmailDesignTool,
  promoteEmailDesignTool,
];

export const emailTools = [
  createEmailTemplateTool,
  listEmailTemplatesTool,
  prepareEmailTool,
  createEmailSequenceTool,
  sendEmailTool,
  listEmailDesignStartersTool,
  createEmailDesignTool,
  listEmailDesignsTool,
  updateEmailDesignTool,
  renderEmailDesignTool,
  promoteEmailDesignTool,
];
