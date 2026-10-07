/**
 * Email templates + sending service (Phase 10).
 *
 * Pipeline per call (PDF #12 §16):
 *  AUTHENTICATE (actor resolved by caller) -> AUTHORIZE (permission guard,
 *  organization-scoped) -> VALIDATE INPUT (Zod in validation.ts) ->
 *  DATABASE (tenant-scoped repository; RLS underneath) -> EXTERNAL PROVIDER
 *  (where required, server-side only) -> LOG (audit) -> RESPONSE (ServiceResult).
 *
 * Tenant rules mirror clients/content/inbox:
 *  - organization_id always from actor.organizationId
 *  - reads/updates filter by organization; other-org rows resolve to NOT_FOUND
 */

import { newId } from '@/lib/id';
import { fail, ok, type ServiceResult } from '@/lib/result';
import { checkPermission } from '@/server/auth/permissions';
import type { NibrexoRepository } from '@/server/db/types';
import { writeAudit } from '@/server/manager/audit';
import { createEmailProvider } from '@/server/integrations/email/provider';
import type { ActorContext, EmailLog, EmailTemplate, UUID } from '@/types/domain';
import {
  malformedPlaceholderError,
  renderTemplate,
  variablesFromTemplate,
  type CreateTemplateInput,
  type EmailLogListQuery,
  type PreviewTemplateInput,
  type SendEmailInput,
  type TemplateListQuery,
  type UpdateTemplateInput,
} from './validation';

export const TEMPLATE_LIST_WINDOW = 500;
export const LOG_LIST_WINDOW = 500;

function permissionDenied(actor: ActorContext, action: string) {
  return fail(
    'PERMISSION_DENIED',
    `Role "${actor.role}" does not have "${action}" permission on module "email".`,
    { errorClass: 'permission', severity: 'error' },
  );
}

function notFound(code: 'TEMPLATE_NOT_FOUND' | 'EMAIL_NOT_FOUND'): ServiceResult<never> {
  const message = code === 'TEMPLATE_NOT_FOUND' ? 'Email template not found.' : 'Email record not found.';
  return fail(code, message, { errorClass: 'validation', severity: 'warning' });
}

// Keep provider secrets out of error messages / audit metadata.
function redactSecret(text: string): string {
  return text
    .replace(/re_[a-zA-Z0-9_-]{10,}/g, 're_***')
    .replace(/Bearer\s+re_[a-zA-Z0-9_-]+/gi, 'Bearer re_***');
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface TemplateListResult {
  templates: EmailTemplate[];
  total: number;
  limit: number;
  offset: number;
}

export async function listTemplates(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: TemplateListQuery,
): Promise<ServiceResult<TemplateListResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const all = await repo.emailTemplates.list(actor.organizationId, { limit: TEMPLATE_LIST_WINDOW });

  const needle = query.search?.trim().toLowerCase() ?? '';
  const filtered = all.filter((template) => {
    if (query.status && (template as unknown as { status?: string }).status !== query.status) {
      // Fallback to archived bool when status column not yet backfilled on old rows
      const isArchived = (template as unknown as EmailTemplate).archived ?? false;
      const status = (template as unknown as { status?: string }).status ?? (isArchived ? 'archived' : 'active');
      if (status !== query.status) return false;
    }
    if (query.category && template.category !== query.category) return false;
    if (query.archived !== undefined && template.archived !== query.archived) return false;
    if (!needle) return true;
    const haystack = [template.name, template.category, template.subject, template.body].join(' ').toLowerCase();
    return needle
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .every((token) => haystack.includes(token));
  });

  const total = filtered.length;
  const items = filtered.slice(query.offset, query.offset + query.limit) as EmailTemplate[];
  return ok({ templates: items, total, limit: query.limit, offset: query.offset });
}

export async function getTemplate(
  actor: ActorContext,
  repo: NibrexoRepository,
  templateId: UUID,
): Promise<ServiceResult<EmailTemplate>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }
  const template = await repo.emailTemplates.get(templateId, actor.organizationId);
  if (!template) return notFound('TEMPLATE_NOT_FOUND');
  return ok(template as EmailTemplate);
}

export async function createTemplate(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: CreateTemplateInput,
): Promise<ServiceResult<EmailTemplate>> {
  if (!checkPermission(actor, { module: 'email', action: 'create' }).allowed) {
    return permissionDenied(actor, 'create');
  }

  const subjectError = malformedPlaceholderError(input.subject);
  if (subjectError) return fail('TEMPLATE_MALFORMED', subjectError, { errorClass: 'validation', severity: 'warning' });
  const bodyError = malformedPlaceholderError(input.body);
  if (bodyError) return fail('TEMPLATE_MALFORMED', bodyError, { errorClass: 'validation', severity: 'warning' });

  const variables = variablesFromTemplate(input.subject, input.body);
  const status = input.status ?? 'active';
  const archived = status === 'archived';

  const template = (await repo.emailTemplates.insert({
    organization_id: actor.organizationId,
    name: input.name.trim(),
    category: input.category.trim(),
    subject: input.subject.trim(),
    body: input.body.trim(),
    variables,
    archived,
    status,
  } as unknown as EmailTemplate)) as EmailTemplate;

  await writeAudit(repo, actor, {
    action: 'email.template.created',
    entityType: 'email_template',
    entityId: template.id,
    metadata: { name: template.name, category: template.category },
  });

  return ok(template);
}

export async function updateTemplate(
  actor: ActorContext,
  repo: NibrexoRepository,
  templateId: UUID,
  input: UpdateTemplateInput,
): Promise<ServiceResult<EmailTemplate>> {
  if (!checkPermission(actor, { module: 'email', action: 'edit' }).allowed) {
    return permissionDenied(actor, 'edit');
  }

  const existing = (await repo.emailTemplates.get(templateId, actor.organizationId)) as EmailTemplate | null;
  if (!existing) return notFound('TEMPLATE_NOT_FOUND');

  const nextSubject = input.subject !== undefined ? input.subject.trim() : existing.subject;
  const nextBody = input.body !== undefined ? input.body.trim() : existing.body;

  if (input.subject !== undefined) {
    const err = malformedPlaceholderError(input.subject);
    if (err) return fail('TEMPLATE_MALFORMED', err, { errorClass: 'validation', severity: 'warning' });
  }
  if (input.body !== undefined) {
    const err = malformedPlaceholderError(input.body);
    if (err) return fail('TEMPLATE_MALFORMED', err, { errorClass: 'validation', severity: 'warning' });
  }

  const patch: Partial<EmailTemplate> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.category !== undefined) patch.category = input.category.trim();
  if (input.subject !== undefined) patch.subject = input.subject.trim();
  if (input.body !== undefined) patch.body = input.body.trim();
  if (input.status !== undefined) {
    (patch as unknown as Record<string, unknown>).status = input.status;
    patch.archived = input.status === 'archived';
  }

  // Recompute variables when subject/body changed
  if (input.subject !== undefined || input.body !== undefined) {
    patch.variables = variablesFromTemplate(nextSubject, nextBody);
  }

  const updated = (await repo.emailTemplates.update(templateId, actor.organizationId, patch as Partial<EmailTemplate>)) as EmailTemplate | null;
  if (!updated) return notFound('TEMPLATE_NOT_FOUND');

  await writeAudit(repo, actor, {
    action: 'email.template.updated',
    entityType: 'email_template',
    entityId: templateId,
    metadata: { changedFields: Object.keys(patch) },
  });

  return ok(updated);
}

export async function deleteTemplate(
  actor: ActorContext,
  repo: NibrexoRepository,
  templateId: UUID,
): Promise<ServiceResult<{ deleted: true }>> {
  if (!checkPermission(actor, { module: 'email', action: 'delete' }).allowed) {
    return permissionDenied(actor, 'delete');
  }

  const existing = await repo.emailTemplates.get(templateId, actor.organizationId);
  if (!existing) return notFound('TEMPLATE_NOT_FOUND');

  const deleted = await repo.emailTemplates.delete(templateId, actor.organizationId);
  if (!deleted) return notFound('TEMPLATE_NOT_FOUND');

  await writeAudit(repo, actor, {
    action: 'email.template.deleted',
    entityType: 'email_template',
    entityId: templateId,
    metadata: {},
  });

  return ok({ deleted: true });
}

export async function previewTemplate(
  actor: ActorContext,
  repo: NibrexoRepository,
  templateId: UUID,
  input: PreviewTemplateInput,
): Promise<ServiceResult<{ subject: string; body: string; unresolved: string[]; variables: string[] }>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }
  const template = (await repo.emailTemplates.get(templateId, actor.organizationId)) as EmailTemplate | null;
  if (!template) return notFound('TEMPLATE_NOT_FOUND');

  const subjectResult = renderTemplate(template.subject, input.variables);
  const bodyResult = renderTemplate(template.body, input.variables);

  return ok({
    subject: subjectResult.rendered,
    body: bodyResult.rendered,
    unresolved: [...new Set([...subjectResult.unresolved, ...bodyResult.unresolved])].sort(),
    variables: template.variables,
  });
}

/* -------------------------------------------------------------------------- */
/* Logs / history                                                              */
/* -------------------------------------------------------------------------- */

export interface EmailLogListResult {
  logs: EmailLog[];
  total: number;
  limit: number;
  offset: number;
}

export async function listEmailLogs(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: EmailLogListQuery,
): Promise<ServiceResult<EmailLogListResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) {
    return permissionDenied(actor, 'view');
  }

  const all = await repo.emailLogs.list(actor.organizationId, { limit: LOG_LIST_WINDOW });
  const needle = query.search?.trim().toLowerCase() ?? '';
  const filtered = (all as EmailLog[]).filter((log) => {
    if (query.status && log.status !== query.status) return false;
    if (!needle) return true;
    const haystack = [log.to_email, log.subject, log.body, log.provider_message_id ?? ''].join(' ').toLowerCase();
    return needle
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .every((token) => haystack.includes(token));
  });

  const total = filtered.length;
  const logs = filtered.slice(query.offset, query.offset + query.limit);
  return ok({ logs, total, limit: query.limit, offset: query.offset });
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                     */
/* -------------------------------------------------------------------------- */

type EmailPreferencesRow = { organization_id: UUID; email: string; opted_out: boolean };

async function isOptedOut(repo: NibrexoRepository, organizationId: UUID, email: string): Promise<boolean> {
  // Repository does not expose email_preferences as a typed collection in all
  // installations (old memory store). Attempt best-effort lookup via generic
  // Supabase collection access, otherwise treat as not opted out.
  const maybe = (repo as unknown as { emailPreferences?: { list: (org: string, opts?: unknown) => Promise<EmailPreferencesRow[]> } }).emailPreferences;
  if (maybe) {
    try {
      const rows = await maybe.list(organizationId, { limit: 200 } as unknown as never);
      const lower = email.toLowerCase();
      return rows.some((row) => row.email.toLowerCase() === lower && row.opted_out);
    } catch {
      return false;
    }
  }
  // Fallback: try raw table access via any collection named email_preferences on memory store
  const rawStore = (repo as unknown as { emailPreferences?: unknown }).emailPreferences;
  if (!rawStore) return false;
  return false;
}

export interface SendEmailResult {
  log: EmailLog;
  providerMessageId: string | null;
  provider: string | null;
  idempotencyKey: string;
  status: EmailLog['status'];
}

/**
 * Compose + send workflow.
 * - Validates recipient, template ownership, variable substitution, client association.
 * - Renders subject/body with variables; rejects unresolved placeholders.
 * - Checks idempotency: same org + idempotencyKey resolves to existing row (no duplicate send).
 * - Stores frozen template snapshot, provider id, error, timestamps, org ownership.
 * - Calls Resend (or reports not_configured) server-side; never exposes secrets.
 */
export async function sendEmail(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: SendEmailInput,
  opts: { idempotencyKey?: string; providerOverride?: ReturnType<typeof createEmailProvider> } = {},
): Promise<ServiceResult<SendEmailResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'send' }).allowed) {
    return permissionDenied(actor, 'send');
  }

  const to = input.to.trim().toLowerCase();
  // Zod already validated email shape; re-check length safety
  if (to.length > 254) {
    return fail('RECIPIENT_INVALID', 'Recipient email is too long.', { errorClass: 'validation', severity: 'warning' });
  }

  // Opt-out guard (best effort)
  if (await isOptedOut(repo, actor.organizationId, to)) {
    return fail('RECIPIENT_OPTED_OUT', 'This recipient has opted out of email communication.', {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  // Client association where appropriate — verify tenant ownership
  const clientId: string | null = input.clientId ?? null;
  if (clientId) {
    const client = await repo.clients.get(clientId, actor.organizationId);
    if (!client) {
      return fail('CLIENT_NOT_FOUND', 'Client not found.', { errorClass: 'validation', severity: 'warning' });
    }
  }

  // Resolve subject/body: either from template + variables or direct input
  let renderedSubject: string;
  let renderedBody: string;
  const templateId: string | null = input.templateId ?? null;
  let templateSnapshot: Record<string, unknown> | null = null;

  if (templateId) {
    const template = (await repo.emailTemplates.get(templateId, actor.organizationId)) as EmailTemplate | null;
    if (!template) return notFound('TEMPLATE_NOT_FOUND');
    // Archived/draft templates cannot be accidentally selected (PDF #10 §4)
    const status = (template as unknown as { status?: string }).status ?? (template.archived ? 'archived' : 'active');
    if (status !== 'active') {
      return fail('TEMPLATE_NOT_SELECTABLE', `Template "${template.name}" is ${status} and cannot be used for sending. Activate it first.`, {
        errorClass: 'validation',
        severity: 'warning',
      });
    }

    // Validate that body/subject overrides are not both missing when template is used without variables?
    // We always render template subject/body with provided variables
    const subjectResult = renderTemplate(template.subject, input.variables);
    const bodyResult = renderTemplate(template.body, input.variables);
    const unresolved = [...new Set([...subjectResult.unresolved, ...bodyResult.unresolved])].sort();
    if (unresolved.length > 0) {
      return fail('VARIABLES_MISSING', `Missing variables for template: ${unresolved.join(', ')}`, {
        errorClass: 'validation',
        severity: 'warning',
      });
    }
    renderedSubject = subjectResult.rendered;
    renderedBody = bodyResult.rendered;
    templateSnapshot = {
      template_id: template.id,
      name: template.name,
      category: template.category,
      subject: template.subject,
      body: template.body,
      variables: template.variables,
      rendered_subject: renderedSubject,
      rendered_body: renderedBody,
      provided_variables: input.variables,
    };
    // If caller also passed explicit subject/body alongside template, ignore them (template is authoritative) —
    // but if they passed nothing extra we already have rendered values.
  } else {
    if (!input.subject || !input.body) {
      return fail('SEND_INPUT_INVALID', 'Provide either a templateId with variables or a subject and body.', {
        errorClass: 'validation',
        severity: 'warning',
      });
    }
    // Check direct subject/body for malformed placeholders — they should have been rendered already,
    // but direct input may still contain {{var}} that must be resolved via variables.
    const subjectResult = renderTemplate(input.subject.trim(), input.variables);
    const bodyResult = renderTemplate(input.body.trim(), input.variables);
    const unresolved = [...new Set([...subjectResult.unresolved, ...bodyResult.unresolved])].sort();
    if (unresolved.length > 0) {
      return fail('VARIABLES_MISSING', `Unresolved variables in content: ${unresolved.join(', ')}`, {
        errorClass: 'validation',
        severity: 'warning',
      });
    }
    // Also reject malformed placeholders in the rendered result (e.g. caller left {{ without closing)
    const subjMalformed = malformedPlaceholderError(subjectResult.rendered);
    if (subjMalformed) return fail('TEMPLATE_MALFORMED', subjMalformed, { errorClass: 'validation', severity: 'warning' });
    const bodyMalformed = malformedPlaceholderError(bodyResult.rendered);
    if (bodyMalformed) return fail('TEMPLATE_MALFORMED', bodyMalformed, { errorClass: 'validation', severity: 'warning' });

    renderedSubject = subjectResult.rendered;
    renderedBody = bodyResult.rendered;
    templateSnapshot = {
      provided_variables: input.variables,
      direct_subject: input.subject,
      direct_body: input.body,
    };
  }

  // Final content sanity: non-empty after rendering
  if (renderedSubject.trim().length === 0 || renderedBody.trim().length === 0) {
    return fail('SEND_INPUT_INVALID', 'Rendered subject and body must not be empty.', {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  const idempotencyKey = (opts.idempotencyKey ?? input.idempotencyKey ?? newId()).trim().slice(0, 256);
  if (idempotencyKey.length === 0) {
    return fail('SEND_INPUT_INVALID', 'Idempotency key must not be empty when provided.', {
      errorClass: 'validation',
      severity: 'warning',
    });
  }

  // Idempotency check: same org + key → existing row (retry-safe). Use bounded window scan.
  // For supabase, the DB unique index is the second line of defense; we still return the existing row
  // without re-calling the provider.
  try {
    const existingScan = await repo.emailLogs.list(actor.organizationId, { limit: LOG_LIST_WINDOW });
    const existing = (existingScan as EmailLog[]).find(
      (row) => (row as EmailLog).idempotency_key === idempotencyKey,
    );
    if (existing) {
      // Already sent/failed — do not duplicate. Return current state.
      // Audit only on first creation; retries are not re-audited as separate sends.
      return ok({
        log: existing,
        providerMessageId: existing.provider_message_id,
        provider: (existing as EmailLog).provider ?? null,
        idempotencyKey,
        status: existing.status,
      });
    }
  } catch {
    // Scan failure is not fatal — fall through to insert path.
  }

  // Create the log in SENDING state before calling the provider (so crashes are visible)
  let log: EmailLog;
  try {
    log = (await repo.emailLogs.insert({
      organization_id: actor.organizationId,
      client_id: clientId,
      template_id: templateId,
      to_email: to,
      subject: renderedSubject,
      body: renderedBody,
      status: 'SENDING' as const,
      provider_message_id: null,
      provider: null,
      idempotency_key: idempotencyKey,
      template_snapshot: templateSnapshot as unknown as EmailLog['template_snapshot'],
      error_message: null,
      created_by: actor.userId,
    } as unknown as EmailLog)) as EmailLog;
  } catch (error) {
    // Unique violation on idempotency_key means a concurrent retry inserted first — fetch and return it.
    const msg = error instanceof Error ? error.message : String(error);
    if (/duplicate|unique|idempotency/i.test(msg)) {
      try {
        const scan = await repo.emailLogs.list(actor.organizationId, { limit: LOG_LIST_WINDOW });
        const found = (scan as EmailLog[]).find((row) => row.idempotency_key === idempotencyKey);
        if (found) {
          return ok({
            log: found,
            providerMessageId: found.provider_message_id,
            provider: (found as EmailLog).provider ?? null,
            idempotencyKey,
            status: found.status,
          });
        }
      } catch {
        // fall through to failure
      }
    }
    return fail('EMAIL_CREATE_FAILED', redactSecret(msg).slice(0, 300), {
      errorClass: 'server',
      severity: 'error',
      retryable: true,
    });
  }

  // Call provider server-side — never expose keys to browser
  const provider = opts.providerOverride ?? createEmailProvider();
  const outcome = await provider.send({
    organizationId: actor.organizationId,
    to,
    subject: renderedSubject,
    html: renderedBody,
    text: renderedBody.replace(/<[^>]+>/g, ''),
    replyTo: input.replyTo,
    idempotencyKey,
  });

  let finalStatus: EmailLog['status'];
  let providerMessageId: string | null = null;
  let providerName: string | null = null;
  let errorMessage: string | null = null;

  if (outcome.status === 'sent') {
    finalStatus = 'SENT';
    providerMessageId = outcome.providerMessageId;
    providerName = outcome.provider;
    errorMessage = null;
  } else if (outcome.status === 'not_configured') {
    finalStatus = 'FAILED';
    errorMessage = redactSecret(outcome.reason);
    providerName = null;
  } else {
    finalStatus = 'FAILED';
    errorMessage = redactSecret(outcome.reason);
    providerName = null;
  }

  // Update log with provider result (never log secrets)
  const updated = (await repo.emailLogs.update(log.id, actor.organizationId, {
    status: finalStatus,
    provider_message_id: providerMessageId,
    provider: providerName,
    error_message: errorMessage,
  } as unknown as Partial<EmailLog>)) as EmailLog | null;

  const finalLog = updated ?? ({ ...log, status: finalStatus, provider_message_id: providerMessageId, provider: providerName, error_message: errorMessage } as EmailLog);

  // Audit — always, but never with secrets or full body
  if (finalStatus === 'SENT') {
    await writeAudit(repo, actor, {
      action: 'email.sent',
      entityType: 'email_log',
      entityId: log.id,
      metadata: {
        to: to,
        template_id: templateId,
        client_id: clientId,
        provider: providerName,
        provider_message_id: providerMessageId,
        idempotency_key: idempotencyKey,
      },
    });
    // CRM timeline sync where client association exists
    if (clientId) {
      try {
        await repo.clientActivity.insert({
          organization_id: actor.organizationId,
          client_id: clientId,
          kind: 'email',
          subject: `Email sent: ${renderedSubject.slice(0, 120)}`,
          body: `To ${to} via ${providerName ?? 'provider'} (id ${providerMessageId ?? '—'}).`,
          actor_id: actor.userId,
        } as never);
      } catch {
        // Non-fatal: log remains, timeline can be retried
      }
    }
  } else {
    await writeAudit(repo, actor, {
      action: 'email.failed',
      entityType: 'email_log',
      entityId: log.id,
      metadata: {
        to,
        template_id: templateId,
        client_id: clientId,
        error: errorMessage?.slice(0, 200) ?? null,
        idempotency_key: idempotencyKey,
      },
    });
  }

  if (finalStatus === 'SENT') {
    return ok({
      log: finalLog,
      providerMessageId,
      provider: providerName,
      idempotencyKey,
      status: finalStatus,
    });
  }

  // Failed — surface honest reason and retryability
  const errorClass = outcome.status === 'not_configured' ? ('not_configured' as const) : ('server' as const);
  const retryable = outcome.status === 'failed' ? outcome.retryable : false;
  return fail(outcome.status === 'not_configured' ? 'EMAIL_NOT_CONFIGURED' : 'EMAIL_SEND_FAILED', errorMessage ?? 'Email send failed.', {
    errorClass,
    severity: 'error',
    retryable,
  });
}
