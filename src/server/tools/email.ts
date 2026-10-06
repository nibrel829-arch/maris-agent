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

export const emailTools = [
  createEmailTemplateTool,
  listEmailTemplatesTool,
  prepareEmailTool,
  createEmailSequenceTool,
  sendEmailTool,
];
