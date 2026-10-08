/**
 * Email sequences service (Phase 11).
 * Reuses Phase 10 templates + provider, adds enrollment, lifecycle, scheduling,
 * suppression and duplicate-send prevention.
 *
 * Tenant isolation: every read/write filtered by actor.organizationId; RLS underneath.
 * Permissions: module email actions view/create/edit/delete/send/approve (admin/owner for send).
 */

import { newId } from '@/lib/id';
import { fail, ok, type ServiceResult } from '@/lib/result';
import { checkPermission } from '@/server/auth/permissions';
import type { NibrexoRepository } from '@/server/db/types';
import { writeAudit } from '@/server/manager/audit';
import { createEmailProvider } from '@/server/integrations/email/provider';
import type {
  ActorContext,
  EmailJob,
  EmailSequence,
  EmailSequenceEnrollment,
  EmailTemplate,
  UUID,
} from '@/types/domain';
import { malformedPlaceholderError, renderTemplate } from './validation';
import type {
  CreateSequenceInput,
  EnrollmentListQuery,
  EnrollSequenceInput,
  SequenceListQuery,
  UpdateSequenceInput,
} from './sequence-validation';

function permissionDenied(actor: ActorContext, action: string) {
  return fail('PERMISSION_DENIED', `Role "${actor.role}" does not have "${action}" permission on module "email".`, {
    errorClass: 'permission' as const,
    severity: 'error' as const,
  });
}

function redactSecret(text: string): string {
  return text.replace(/re_[a-zA-Z0-9_-]{10,}/g, 're_***').replace(/Bearer\s+re_[a-zA-Z0-9_-]+/gi, 'Bearer re_***');
}

async function isOptedOut(repo: NibrexoRepository, organizationId: UUID, email: string): Promise<boolean> {
  const lower = email.toLowerCase();
  try {
    const rows = await repo.emailPreferences.list(organizationId, { limit: 500 });
    return (rows as unknown as { email: string; opted_out: boolean }[]).some((r) => r.email.toLowerCase() === lower && r.opted_out);
  } catch {
    return false;
  }
}

function addDelay(base: Date, days: number, hours: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(d.getUTCHours() + hours);
  return d;
}

/* -------------------------------------------------------------------------- */
/* Validation helpers                                                          */
/* -------------------------------------------------------------------------- */

async function validateSteps(
  actor: ActorContext,
  repo: NibrexoRepository,
  steps: CreateSequenceInput['steps'],
): Promise<ServiceResult<null>> {
  if (!steps.length) return fail('SEQUENCE_INVALID', 'At least one step is required.', { errorClass: 'validation', severity: 'warning' });
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const template = (await repo.emailTemplates.get(step.templateId, actor.organizationId)) as EmailTemplate | null;
    if (!template) return fail('TEMPLATE_NOT_FOUND', `Step ${i + 1}: template not found.`, { errorClass: 'validation', severity: 'warning' });
    const status = (template as unknown as { status?: string }).status ?? (template.archived ? 'archived' : 'active');
    if (status !== 'active') {
      return fail('TEMPLATE_NOT_SELECTABLE', `Step ${i + 1}: template "${template.name}" is ${status} and cannot be used.`, {
        errorClass: 'validation',
        severity: 'warning',
      });
    }
    // Ensure template itself isn't malformed (already validated on creation, but double-check)
    const subjErr = malformedPlaceholderError(template.subject);
    if (subjErr) return fail('TEMPLATE_MALFORMED', `Step ${i + 1} template subject malformed: ${subjErr}`, { errorClass: 'validation', severity: 'warning' });
    const bodyErr = malformedPlaceholderError(template.body);
    if (bodyErr) return fail('TEMPLATE_MALFORMED', `Step ${i + 1} template body malformed: ${bodyErr}`, { errorClass: 'validation', severity: 'warning' });
  }
  return ok(null);
}

/* -------------------------------------------------------------------------- */
/* CRUD for sequences                                                          */
/* -------------------------------------------------------------------------- */

export interface SequenceListResult {
  sequences: EmailSequence[];
  total: number;
  limit: number;
  offset: number;
}

export async function listSequences(
  actor: ActorContext,
  repo: NibrexoRepository,
  query: SequenceListQuery,
): Promise<ServiceResult<SequenceListResult>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) return permissionDenied(actor, 'view');
  const all = (await repo.emailSequences.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequence[];
  const needle = query.search?.trim().toLowerCase() ?? '';
  const filtered = all.filter((seq) => {
    if (query.status && seq.status !== query.status) return false;
    if (!needle) return true;
    const haystack = [seq.name, seq.description ?? '', seq.trigger].join(' ').toLowerCase();
    return needle
      .split(/\s+/)
      .filter(Boolean)
      .every((tok) => haystack.includes(tok));
  });
  filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const total = filtered.length;
  const items = filtered.slice(query.offset, query.offset + query.limit);
  return ok({ sequences: items, total, limit: query.limit, offset: query.offset });
}

export async function getSequence(
  actor: ActorContext,
  repo: NibrexoRepository,
  id: UUID,
): Promise<ServiceResult<EmailSequence>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) return permissionDenied(actor, 'view');
  const seq = (await repo.emailSequences.get(id, actor.organizationId)) as unknown as EmailSequence | null;
  if (!seq) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  return ok(seq);
}

export async function createSequence(
  actor: ActorContext,
  repo: NibrexoRepository,
  input: CreateSequenceInput,
): Promise<ServiceResult<EmailSequence>> {
  if (!checkPermission(actor, { module: 'email', action: 'create' }).allowed) return permissionDenied(actor, 'create');
  const validation = await validateSteps(actor, repo, input.steps);
  if (!validation.ok) return validation as unknown as ServiceResult<EmailSequence>;

  const status = input.status ?? 'draft';
  const seq = (await repo.emailSequences.insert({
    organization_id: actor.organizationId,
    name: input.name.trim(),
    description: input.description?.trim() ?? null,
    trigger: input.trigger.trim(),
    steps: input.steps.map((s) => ({ templateId: s.templateId, delayDays: s.delayDays, delayHours: s.delayHours })),
    stop_conditions: input.stopConditions,
    status,
    created_by: actor.userId,
  } as unknown as EmailSequence)) as unknown as EmailSequence;

  await writeAudit(repo, actor, {
    action: 'email.sequence.created',
    entityType: 'email_sequence',
    entityId: seq.id,
    metadata: { name: seq.name, steps: seq.steps.length },
  });

  // Optionally populate normalized email_steps rows for legacy readers
  try {
    for (let i = 0; i < input.steps.length; i++) {
      const s = input.steps[i]!;
      await repo.emailSteps.insert({
        organization_id: actor.organizationId,
        sequence_id: seq.id,
        position: i,
        delay_days: s.delayDays,
        delay_hours: s.delayHours,
        template_id: s.templateId,
        subject: `Step ${i + 1}`,
        body: null,
      } as unknown as never);
    }
  } catch {
    // non-fatal
  }

  return ok(seq);
}

export async function updateSequence(
  actor: ActorContext,
  repo: NibrexoRepository,
  id: UUID,
  input: UpdateSequenceInput,
): Promise<ServiceResult<EmailSequence>> {
  if (!checkPermission(actor, { module: 'email', action: 'edit' }).allowed) return permissionDenied(actor, 'edit');
  const existing = (await repo.emailSequences.get(id, actor.organizationId)) as unknown as EmailSequence | null;
  if (!existing) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });

  if (input.steps) {
    const v = await validateSteps(actor, repo, input.steps);
    if (!v.ok) return v as unknown as ServiceResult<EmailSequence>;
  }

  const patch: Partial<EmailSequence> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) (patch as unknown as Record<string, unknown>).description = input.description?.trim() ?? null;
  if (input.trigger !== undefined) patch.trigger = input.trigger.trim();
  if (input.steps !== undefined) (patch as unknown as Record<string, unknown>).steps = input.steps.map((s) => ({ templateId: s.templateId, delayDays: s.delayDays, delayHours: s.delayHours }));
  if (input.stopConditions !== undefined) (patch as unknown as Record<string, unknown>).stop_conditions = input.stopConditions;
  if (input.status !== undefined) patch.status = input.status as EmailSequence['status'];

  const updated = (await repo.emailSequences.update(id, actor.organizationId, patch as unknown as Partial<EmailSequence>)) as unknown as EmailSequence | null;
  if (!updated) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });

  await writeAudit(repo, actor, {
    action: 'email.sequence.updated',
    entityType: 'email_sequence',
    entityId: id,
    metadata: { changedFields: Object.keys(patch) },
  });
  return ok(updated);
}

export async function deleteSequence(
  actor: ActorContext,
  repo: NibrexoRepository,
  id: UUID,
): Promise<ServiceResult<{ deleted: true }>> {
  if (!checkPermission(actor, { module: 'email', action: 'delete' }).allowed) return permissionDenied(actor, 'delete');
  const existing = await repo.emailSequences.get(id, actor.organizationId);
  if (!existing) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  await repo.emailSequences.delete(id, actor.organizationId);
  // Best-effort cascade: cancel pending enrollments/jobs
  try {
    const enrollments = (await repo.emailEnrollments.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequenceEnrollment[];
    for (const e of enrollments.filter((en) => en.sequence_id === id)) {
      await repo.emailEnrollments.update(e.id, actor.organizationId, { status: 'cancelled', cancelled_at: new Date().toISOString() } as unknown as Partial<EmailSequenceEnrollment>);
    }
    const jobs = (await repo.emailJobs.list(actor.organizationId, { limit: 500 })) as unknown as EmailJob[];
    for (const j of jobs.filter((job) => job.sequence_id === id && job.status === 'queued')) {
      await repo.emailJobs.update(j.id, actor.organizationId, { status: 'cancelled', last_error: 'Sequence deleted' } as unknown as Partial<EmailJob>);
    }
  } catch {}
  await writeAudit(repo, actor, { action: 'email.sequence.deleted', entityType: 'email_sequence', entityId: id, metadata: {} });
  return ok({ deleted: true });
}

/* -------------------------------------------------------------------------- */
/* Lifecycle: start / pause / resume / archive                                 */
/* -------------------------------------------------------------------------- */

export async function startSequence(actor: ActorContext, repo: NibrexoRepository, id: UUID): Promise<ServiceResult<EmailSequence>> {
  if (!checkPermission(actor, { module: 'email', action: 'send' }).allowed) return permissionDenied(actor, 'send');
  const seq = (await repo.emailSequences.get(id, actor.organizationId)) as unknown as EmailSequence | null;
  if (!seq) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  if (seq.status === 'active') return ok(seq);
  if (seq.status === 'archived' || seq.status === 'completed') return fail('SEQUENCE_INVALID_STATE', 'Archived/completed sequences cannot be started.', { errorClass: 'validation', severity: 'warning' });
  const updated = (await repo.emailSequences.update(id, actor.organizationId, { status: 'active' } as unknown as Partial<EmailSequence>)) as unknown as EmailSequence;
  await writeAudit(repo, actor, { action: 'email.sequence.started', entityType: 'email_sequence', entityId: id, metadata: {} });
  return ok(updated);
}

export async function pauseSequence(actor: ActorContext, repo: NibrexoRepository, id: UUID): Promise<ServiceResult<EmailSequence>> {
  if (!checkPermission(actor, { module: 'email', action: 'send' }).allowed) return permissionDenied(actor, 'send');
  const seq = (await repo.emailSequences.get(id, actor.organizationId)) as unknown as EmailSequence | null;
  if (!seq) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  if (seq.status !== 'active') return fail('SEQUENCE_INVALID_STATE', 'Only active sequences can be paused.', { errorClass: 'validation', severity: 'warning' });
  const updated = (await repo.emailSequences.update(id, actor.organizationId, { status: 'paused' } as unknown as Partial<EmailSequence>)) as unknown as EmailSequence;
  // Pause active enrollments
  try {
    const enrollments = (await repo.emailEnrollments.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequenceEnrollment[];
    for (const e of enrollments.filter((en) => en.sequence_id === id && en.status === 'active')) {
      await repo.emailEnrollments.update(e.id, actor.organizationId, { status: 'paused' } as unknown as Partial<EmailSequenceEnrollment>);
    }
  } catch {}
  await writeAudit(repo, actor, { action: 'email.sequence.paused', entityType: 'email_sequence', entityId: id, metadata: {} });
  return ok(updated);
}

export async function resumeSequence(actor: ActorContext, repo: NibrexoRepository, id: UUID): Promise<ServiceResult<EmailSequence>> {
  if (!checkPermission(actor, { module: 'email', action: 'send' }).allowed) return permissionDenied(actor, 'send');
  const seq = (await repo.emailSequences.get(id, actor.organizationId)) as unknown as EmailSequence | null;
  if (!seq) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  if (seq.status !== 'paused') return fail('SEQUENCE_INVALID_STATE', 'Only paused sequences can be resumed.', { errorClass: 'validation', severity: 'warning' });
  const updated = (await repo.emailSequences.update(id, actor.organizationId, { status: 'active' } as unknown as Partial<EmailSequence>)) as unknown as EmailSequence;
  try {
    const enrollments = (await repo.emailEnrollments.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequenceEnrollment[];
    for (const e of enrollments.filter((en) => en.sequence_id === id && en.status === 'paused')) {
      await repo.emailEnrollments.update(e.id, actor.organizationId, { status: 'active' } as unknown as Partial<EmailSequenceEnrollment>);
    }
  } catch {}
  await writeAudit(repo, actor, { action: 'email.sequence.resumed', entityType: 'email_sequence', entityId: id, metadata: {} });
  return ok(updated);
}

export async function archiveSequence(actor: ActorContext, repo: NibrexoRepository, id: UUID): Promise<ServiceResult<EmailSequence>> {
  if (!checkPermission(actor, { module: 'email', action: 'delete' }).allowed) return permissionDenied(actor, 'delete');
  const seq = (await repo.emailSequences.get(id, actor.organizationId)) as unknown as EmailSequence | null;
  if (!seq) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  if (seq.status === 'archived') return ok(seq);
  const updated = (await repo.emailSequences.update(id, actor.organizationId, { status: 'archived' } as unknown as Partial<EmailSequence>)) as unknown as EmailSequence;
  try {
    const enrollments = (await repo.emailEnrollments.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequenceEnrollment[];
    for (const e of enrollments.filter((en) => en.sequence_id === id && (en.status === 'active' || en.status === 'paused'))) {
      await repo.emailEnrollments.update(e.id, actor.organizationId, { status: 'cancelled', cancelled_at: new Date().toISOString() } as unknown as Partial<EmailSequenceEnrollment>);
    }
    const jobs = (await repo.emailJobs.list(actor.organizationId, { limit: 500 })) as unknown as EmailJob[];
    for (const j of jobs.filter((job) => job.sequence_id === id && job.status === 'queued')) {
      await repo.emailJobs.update(j.id, actor.organizationId, { status: 'cancelled', last_error: 'Sequence archived' } as unknown as Partial<EmailJob>);
    }
  } catch {}
  await writeAudit(repo, actor, { action: 'email.sequence.archived', entityType: 'email_sequence', entityId: id, metadata: {} });
  return ok(updated);
}

/* -------------------------------------------------------------------------- */
/* Enrollment                                                                  */
/* -------------------------------------------------------------------------- */

export async function enrollInSequence(
  actor: ActorContext,
  repo: NibrexoRepository,
  sequenceId: UUID,
  input: EnrollSequenceInput,
): Promise<ServiceResult<{ enrolled: number; enrollments: EmailSequenceEnrollment[] }>> {
  if (!checkPermission(actor, { module: 'email', action: 'send' }).allowed) return permissionDenied(actor, 'send');

  const seq = (await repo.emailSequences.get(sequenceId, actor.organizationId)) as unknown as EmailSequence | null;
  if (!seq) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  if (seq.status !== 'active') return fail('SEQUENCE_NOT_ACTIVE', 'Only active sequences can enroll recipients. Start the sequence first.', { errorClass: 'validation', severity: 'warning' });
  if (!seq.steps || seq.steps.length === 0) return fail('SEQUENCE_INVALID', 'Sequence has no steps.', { errorClass: 'validation', severity: 'warning' });

  // Validate steps again (templates still active)
  const stepValidation = await validateSteps(actor, repo, seq.steps as unknown as CreateSequenceInput['steps']);
  if (!stepValidation.ok) return stepValidation as unknown as ServiceResult<{ enrolled: number; enrollments: EmailSequenceEnrollment[] }>;

  // Collect recipient emails from clientIds + direct emails
  const recipients: { email: string; clientId: string | null }[] = [];

  for (const cid of input.clientIds) {
    const client = await repo.clients.get(cid, actor.organizationId);
    if (!client) return fail('CLIENT_NOT_FOUND', `Client ${cid} not found.`, { errorClass: 'validation', severity: 'warning' });
    if (!client.email || client.email.trim() === '') return fail('RECIPIENT_INVALID', `Client ${client.name} has no email.`, { errorClass: 'validation', severity: 'warning' });
    const email = client.email.trim().toLowerCase();
    // Validate email format via simple Zod-like check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('RECIPIENT_INVALID', `Client ${client.name} has invalid email.`, { errorClass: 'validation', severity: 'warning' });
    recipients.push({ email, clientId: cid });
  }
  for (const emailRaw of input.emails) {
    const email = emailRaw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('RECIPIENT_INVALID', `Invalid email: ${emailRaw}`, { errorClass: 'validation', severity: 'warning' });
    recipients.push({ email, clientId: null });
  }

  if (recipients.length === 0) return fail('ENROLL_INPUT_INVALID', 'Provide at least one clientId or email.', { errorClass: 'validation', severity: 'warning' });

  // Deduplicate by email within request
  const seen = new Set<string>();
  const deduped = recipients.filter((r) => {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Check existing enrollments to prevent duplicate enrollment
  const existingAll = (await repo.emailEnrollments.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequenceEnrollment[];
  const existingEmails = new Set(existingAll.filter((e) => e.sequence_id === sequenceId).map((e) => e.email.toLowerCase()));

  const enrollments: EmailSequenceEnrollment[] = [];
  let enrolledCount = 0;

  for (const rec of deduped) {
    const lower = rec.email.toLowerCase();
    if (existingEmails.has(lower)) {
      // Already enrolled — skip, do not create duplicate enrollment or job
      continue;
    }
    // Suppression guard: no enrollment if opted out
    if (await isOptedOut(repo, actor.organizationId, lower)) {
      // Do not enroll suppressed recipients — they are silently skipped but we record as unsubscribed
      const enrollment = (await repo.emailEnrollments.insert({
        organization_id: actor.organizationId,
        sequence_id: sequenceId,
        client_id: rec.clientId,
        email: lower,
        status: 'unsubscribed',
        current_step: 0,
        next_run_at: null,
        enrolled_by: actor.userId,
        enrolled_at: new Date().toISOString(),
        last_error: 'Recipient has opted out',
      } as unknown as EmailSequenceEnrollment)) as unknown as EmailSequenceEnrollment;
      enrollments.push(enrollment);
      continue;
    }

    const enrollment = (await repo.emailEnrollments.insert({
      organization_id: actor.organizationId,
      sequence_id: sequenceId,
      client_id: rec.clientId,
      email: lower,
      status: 'active',
      current_step: 0,
      next_run_at: new Date().toISOString(),
      enrolled_by: actor.userId,
      enrolled_at: new Date().toISOString(),
    } as unknown as EmailSequenceEnrollment)) as unknown as EmailSequenceEnrollment;
    enrollments.push(enrollment);
    enrolledCount++;

    // Create the first job (step 0) immediate; subsequent steps will be scheduled by worker after each send
    const step0 = (seq.steps as unknown as { templateId: string; delayDays: number; delayHours: number }[])[0]!;
    const runAt = addDelay(new Date(), step0.delayDays, step0.delayHours);
    const idempotencyKey = `seq:${sequenceId}:enr:${enrollment.id}:step:0:${newId()}`.slice(0, 256);
    try {
      await repo.emailJobs.insert({
        organization_id: actor.organizationId,
        sequence_id: sequenceId,
        enrollment_id: enrollment.id,
        client_id: rec.clientId,
        to_email: lower,
        template_id: step0.templateId,
        variables: input.variables,
        idempotency_key: idempotencyKey,
        run_at: runAt.toISOString(),
        status: 'queued',
        attempts: 0,
        max_attempts: 5,
        last_error: null,
      } as unknown as EmailJob);
    } catch {
      // If job insert fails (duplicate idempotency), enrollment already exists — ignore
    }
  }

  if (enrolledCount > 0) {
    await writeAudit(repo, actor, {
      action: 'email.sequence.enrolled',
      entityType: 'email_sequence',
      entityId: sequenceId,
      metadata: { enrolled: enrolledCount, totalRequested: deduped.length },
    });
  }

  return ok({ enrolled: enrolledCount, enrollments });
}

export async function listEnrollments(
  actor: ActorContext,
  repo: NibrexoRepository,
  sequenceId: UUID,
  query: EnrollmentListQuery,
): Promise<ServiceResult<{ enrollments: EmailSequenceEnrollment[]; total: number; limit: number; offset: number }>> {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) return permissionDenied(actor, 'view');
  const seq = await repo.emailSequences.get(sequenceId, actor.organizationId);
  if (!seq) return fail('SEQUENCE_NOT_FOUND', 'Sequence not found.', { errorClass: 'validation', severity: 'warning' });
  const all = (await repo.emailEnrollments.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequenceEnrollment[];
  let filtered = all.filter((e) => e.sequence_id === sequenceId);
  if (query.status) filtered = filtered.filter((e) => e.status === query.status);
  if (query.search) {
    const needle = query.search.toLowerCase();
    filtered = filtered.filter((e) => e.email.toLowerCase().includes(needle));
  }
  filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const total = filtered.length;
  const items = filtered.slice(query.offset, query.offset + query.limit);
  return ok({ enrollments: items, total, limit: query.limit, offset: query.offset });
}

export async function cancelEnrollment(
  actor: ActorContext,
  repo: NibrexoRepository,
  enrollmentId: UUID,
): Promise<ServiceResult<EmailSequenceEnrollment>> {
  if (!checkPermission(actor, { module: 'email', action: 'send' }).allowed) return permissionDenied(actor, 'send');
  const enrollment = (await repo.emailEnrollments.get(enrollmentId, actor.organizationId)) as unknown as EmailSequenceEnrollment | null;
  if (!enrollment) return fail('ENROLLMENT_NOT_FOUND', 'Enrollment not found.', { errorClass: 'validation', severity: 'warning' });
  if (enrollment.status === 'cancelled' || enrollment.status === 'completed') return ok(enrollment);
  const updated = (await repo.emailEnrollments.update(enrollmentId, actor.organizationId, { status: 'cancelled', cancelled_at: new Date().toISOString() } as unknown as Partial<EmailSequenceEnrollment>)) as unknown as EmailSequenceEnrollment;
  // Cancel pending jobs
  try {
    const jobs = (await repo.emailJobs.list(actor.organizationId, { limit: 500 })) as unknown as EmailJob[];
    for (const j of jobs.filter((job) => job.enrollment_id === enrollmentId && job.status === 'queued')) {
      await repo.emailJobs.update(j.id, actor.organizationId, { status: 'cancelled', last_error: 'Enrollment cancelled' } as unknown as Partial<EmailJob>);
    }
  } catch {}
  await writeAudit(repo, actor, { action: 'email.sequence.cancelled', entityType: 'email_sequence_enrollment', entityId: enrollmentId, metadata: { sequence_id: enrollment.sequence_id } });
  return ok(updated);
}

/* -------------------------------------------------------------------------- */
/* Suppression / unsubscribe                                                   */
/* -------------------------------------------------------------------------- */

export async function unsubscribeEmail(
  actor: ActorContext,
  repo: NibrexoRepository,
  email: string,
): Promise<ServiceResult<{ opted_out: boolean }>> {
  if (!checkPermission(actor, { module: 'email', action: 'edit' }).allowed) return permissionDenied(actor, 'edit');
  const lower = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return fail('RECIPIENT_INVALID', 'Invalid email.', { errorClass: 'validation', severity: 'warning' });

  // Upsert preference
  const existing = (await repo.emailPreferences.list(actor.organizationId, { limit: 500 })) as unknown as { id: string; email: string; opted_out: boolean }[];
  const found = existing.find((r) => r.email.toLowerCase() === lower);
  if (found) {
    await repo.emailPreferences.update(found.id, actor.organizationId, { opted_out: true, opted_out_at: new Date().toISOString() } as unknown as never);
  } else {
    await repo.emailPreferences.insert({ organization_id: actor.organizationId, email: lower, opted_out: true, opted_out_at: new Date().toISOString() } as unknown as never);
  }

  // Mark enrollments as unsubscribed and cancel jobs
  try {
    const enrollments = (await repo.emailEnrollments.list(actor.organizationId, { limit: 500 })) as unknown as EmailSequenceEnrollment[];
    for (const en of enrollments.filter((e) => e.email.toLowerCase() === lower && (e.status === 'active' || e.status === 'paused'))) {
      await repo.emailEnrollments.update(en.id, actor.organizationId, { status: 'unsubscribed', last_error: 'Recipient unsubscribed' } as unknown as Partial<EmailSequenceEnrollment>);
      const jobs = (await repo.emailJobs.list(actor.organizationId, { limit: 500 })) as unknown as EmailJob[];
      for (const j of jobs.filter((job) => job.enrollment_id === en.id && job.status === 'queued')) {
        await repo.emailJobs.update(j.id, actor.organizationId, { status: 'cancelled', last_error: 'Recipient unsubscribed' } as unknown as Partial<EmailJob>);
      }
    }
    // Also cancel any standalone jobs for this email not tied to enrollment? e.g., future direct?
    const jobs = (await repo.emailJobs.list(actor.organizationId, { limit: 500 })) as unknown as EmailJob[];
    for (const j of jobs.filter((job) => job.to_email?.toLowerCase() === lower && job.status === 'queued')) {
      await repo.emailJobs.update(j.id, actor.organizationId, { status: 'cancelled', last_error: 'Recipient unsubscribed' } as unknown as Partial<EmailJob>);
    }
  } catch {}

  await writeAudit(repo, actor, { action: 'email.sequence.cancelled', entityType: 'email_preference', entityId: lower, metadata: { email: lower, reason: 'unsubscribed' } });
  return ok({ opted_out: true });
}

export async function resubscribeEmail(actor: ActorContext, repo: NibrexoRepository, email: string): Promise<ServiceResult<{ opted_out: boolean }>> {
  if (!checkPermission(actor, { module: 'email', action: 'edit' }).allowed) return permissionDenied(actor, 'edit');
  const lower = email.trim().toLowerCase();
  const existing = (await repo.emailPreferences.list(actor.organizationId, { limit: 500 })) as unknown as { id: string; email: string }[];
  const found = existing.find((r) => r.email.toLowerCase() === lower);
  if (found) {
    await repo.emailPreferences.update(found.id, actor.organizationId, { opted_out: false, opted_out_at: null } as unknown as never);
  }
  return ok({ opted_out: false });
}

/* -------------------------------------------------------------------------- */
/* Worker — execute due jobs                                                  */
/* -------------------------------------------------------------------------- */

export interface RunDueJobsResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export async function runDueJobs(
  repo: NibrexoRepository,
  opts: { providerOverride?: ReturnType<typeof createEmailProvider>; nowIso?: string; limit?: number } = {},
): Promise<ServiceResult<RunDueJobsResult>> {
  const nowIso = opts.nowIso ?? new Date().toISOString();
  const limit = opts.limit ?? 10;
  const lockSeconds = 120;

  // Claim due jobs (single-flight)
  let claimed: EmailJob[];
  try {
    // Prefer collection claim method (memory + supabase with RPC)
    claimed = await (repo.emailJobs as unknown as { claimDueJobs: (a: string, b: number, c: number) => Promise<EmailJob[]> }).claimDueJobs(nowIso, lockSeconds, limit);
  } catch (e) {
    // Fallback: manual list scan (if RPC missing)
    const all = (await repo.emailJobs.list('' as unknown as UUID, { limit: 500 })) as unknown as EmailJob[]; // fallback won't be used, but keep
    claimed = [];
    void all;
    return fail('CLAIM_FAILED', `Failed to claim jobs: ${String(e)}`, { errorClass: 'server', severity: 'error' });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let cancelled = 0;

  for (const job of claimed) {
    // Load sequence + enrollment
    const seq = job.sequence_id ? ((await repo.emailSequences.get(job.sequence_id, job.organization_id)) as unknown as EmailSequence | null) : null;
    const enrollment = job.enrollment_id ? ((await repo.emailEnrollments.get(job.enrollment_id, job.organization_id)) as unknown as EmailSequenceEnrollment | null) : null;

    // Guards: if sequence archived/paused or enrollment not active, skip/cancel
    if (seq && (seq.status === 'archived' || seq.status === 'completed')) {
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'cancelled', last_error: 'Sequence archived/completed' } as unknown as Partial<EmailJob>);
      cancelled++;
      continue;
    }
    if (seq && seq.status === 'paused') {
      // Keep queued but not claimable while paused — reset lock so next worker after resume can claim immediately
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'queued', locked_at: null } as unknown as Partial<EmailJob>);
      skipped++;
      continue;
    }
    if (enrollment && enrollment.status !== 'active') {
      // enrollment paused/completed/cancelled/unsubscribed -> cancel job
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'cancelled', last_error: `Enrollment ${enrollment.status}` } as unknown as Partial<EmailJob>);
      cancelled++;
      continue;
    }

    const recipient = (job.to_email ?? enrollment?.email ?? '').toLowerCase();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'failed', last_error: 'Invalid recipient' } as unknown as Partial<EmailJob>);
      failed++;
      continue;
    }

    if (await isOptedOut(repo, job.organization_id, recipient)) {
      // Mark enrollment unsubscribed and job skipped
      if (enrollment) {
        await repo.emailEnrollments.update(enrollment.id, job.organization_id, { status: 'unsubscribed', last_error: 'Opted out' } as unknown as Partial<EmailSequenceEnrollment>);
      }
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'skipped' as unknown as EmailJob['status'], last_error: 'Recipient opted out / suppressed' } as unknown as Partial<EmailJob>);
      skipped++;
      // Cancel remaining queued jobs for this enrollment
      try {
        const pending = (await repo.emailJobs.list(job.organization_id, { limit: 500 })) as unknown as EmailJob[];
        for (const p of pending.filter((j) => j.enrollment_id === job.enrollment_id && j.status === 'queued')) {
          await repo.emailJobs.update(p.id, job.organization_id, { status: 'cancelled', last_error: 'Recipient unsubscribed' } as unknown as Partial<EmailJob>);
        }
      } catch {}
      continue;
    }

    // Need template for this step
    const stepTemplateId = job.template_id;
    if (!stepTemplateId) {
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'failed', last_error: 'No template for step' } as unknown as Partial<EmailJob>);
      failed++;
      continue;
    }
    const template = (await repo.emailTemplates.get(stepTemplateId, job.organization_id)) as EmailTemplate | null;
    if (!template) {
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'failed', last_error: 'Template not found' } as unknown as Partial<EmailJob>);
      failed++;
      continue;
    }
    const tplStatus = (template as unknown as { status?: string }).status ?? (template.archived ? 'archived' : 'active');
    if (tplStatus !== 'active') {
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'failed', last_error: `Template ${tplStatus}` } as unknown as Partial<EmailJob>);
      failed++;
      continue;
    }

    // Render with job variables + enrollment email context
    const vars = (job.variables ?? {}) as Record<string, string>;
    const subjectRendered = renderTemplate(template.subject, vars);
    const bodyRendered = renderTemplate(template.body, vars);
    const unresolved = [...new Set([...subjectRendered.unresolved, ...bodyRendered.unresolved])].sort();
    if (unresolved.length > 0) {
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'failed', last_error: `Missing variables: ${unresolved.join(', ')}` } as unknown as Partial<EmailJob>);
      failed++;
      continue;
    }
    const renderedSubject = subjectRendered.rendered;
    const renderedBody = bodyRendered.rendered;

    // Send via provider (idempotency = job.idempotency_key)
    const provider = opts.providerOverride ?? createEmailProvider();

    // If provider not configured -> fail without retry (but don't mark as retryable, inform operator)
    if (!provider.isConfigured()) {
      await repo.emailJobs.update(job.id, job.organization_id, { status: 'failed', last_error: 'Email provider not configured' } as unknown as Partial<EmailJob>);
      failed++;
      continue;
    }

    const outcome = await provider.send({
      organizationId: job.organization_id,
      to: recipient,
      subject: renderedSubject,
      html: renderedBody,
      text: renderedBody.replace(/<[^>]+>/g, ''),
      idempotencyKey: job.idempotency_key,
    });

    if (outcome.status === 'sent') {
      await repo.emailJobs.update(job.id, job.organization_id, {
        status: 'sent',
        provider_message_id: outcome.providerMessageId,
        provider: outcome.provider,
        last_error: null,
        locked_at: null,
      } as unknown as Partial<EmailJob>);

      // Create email_logs SENT record for history
      try {
        await repo.emailLogs.insert({
          organization_id: job.organization_id,
          client_id: job.client_id ?? enrollment?.client_id ?? null,
          template_id: stepTemplateId,
          to_email: recipient,
          subject: renderedSubject,
          body: renderedBody,
          status: 'SENT',
          provider_message_id: outcome.providerMessageId,
          provider: outcome.provider,
          idempotency_key: job.idempotency_key,
          template_snapshot: {
            template_id: template.id,
            name: template.name,
            rendered_subject: renderedSubject,
            rendered_body: renderedBody,
            sequence_id: job.sequence_id,
            enrollment_id: job.enrollment_id,
          } as unknown as never,
          error_message: null,
          created_by: null,
        } as unknown as never);
      } catch {}

      // CRM timeline
      if (enrollment?.client_id || job.client_id) {
        const cid = (enrollment?.client_id ?? job.client_id) as string;
        try {
          await repo.clientActivity.insert({
            organization_id: job.organization_id,
            client_id: cid,
            kind: 'email',
            subject: `Sequence email sent: ${renderedSubject.slice(0, 120)}`,
            body: `To ${recipient} via ${outcome.provider} (seq ${job.sequence_id} step ${enrollment?.current_step ?? '?'})`,
            actor_id: null,
          } as never);
        } catch {}
      }

      sent++;

      // Schedule next step if enrollment has more steps
      if (seq && enrollment) {
        const steps = seq.steps as unknown as { templateId: string; delayDays: number; delayHours: number }[];
        const nextIdx = (enrollment.current_step ?? 0) + 1;
        if (nextIdx < steps.length) {
          const nextStep = steps[nextIdx]!;
          const runAt = addDelay(new Date(nowIso), nextStep.delayDays, nextStep.delayHours);
          await repo.emailEnrollments.update(enrollment.id, job.organization_id, {
            current_step: nextIdx,
            next_run_at: runAt.toISOString(),
          } as unknown as Partial<EmailSequenceEnrollment>);
          const nextIdempotency = `seq:${seq.id}:enr:${enrollment.id}:step:${nextIdx}:${newId()}`.slice(0, 256);
          await repo.emailJobs.insert({
            organization_id: job.organization_id,
            sequence_id: seq.id,
            enrollment_id: enrollment.id,
            client_id: enrollment.client_id,
            to_email: recipient,
            template_id: nextStep.templateId,
            variables: job.variables,
            idempotency_key: nextIdempotency,
            run_at: runAt.toISOString(),
            status: 'queued',
            attempts: 0,
            max_attempts: 5,
          } as unknown as EmailJob);
        } else {
          // Completed
          await repo.emailEnrollments.update(enrollment.id, job.organization_id, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            current_step: nextIdx,
            next_run_at: null,
          } as unknown as Partial<EmailSequenceEnrollment>);
          await writeAudit(repo, { userId: '00000000-0000-0000-0000-000000000000', organizationId: job.organization_id, role: 'owner', email: null, fullName: null, isDevIdentity: true } as ActorContext, {
            action: 'email.sequence.completed',
            entityType: 'email_sequence_enrollment',
            entityId: enrollment.id,
            metadata: { sequence_id: seq.id },
          });
        }
      }

      // Audit sent
      await writeAudit(repo, { userId: '00000000-0000-0000-0000-000000000000', organizationId: job.organization_id, role: 'owner', email: null, fullName: null, isDevIdentity: true } as ActorContext, {
        action: 'email.sent',
        entityType: 'email_log',
        entityId: job.id,
        metadata: { to: recipient, sequence_id: job.sequence_id, enrollment_id: job.enrollment_id, provider: outcome.provider, provider_message_id: outcome.providerMessageId },
      });
    } else if (outcome.status === 'failed' && (outcome as { retryable: boolean }).retryable) {
      // Retryable → requeue with backoff if attempts left
      if (job.attempts < job.max_attempts) {
        const backoffMinutes = Math.min(60, Math.pow(2, job.attempts) * 2); // 2,4,8,16,32,60
        const nextRetry = new Date(Date.parse(nowIso) + backoffMinutes * 60 * 1000).toISOString();
        await repo.emailJobs.update(job.id, job.organization_id, {
          status: 'queued',
          run_at: nextRetry,
          next_retry_at: nextRetry,
          last_error: redactSecret(outcome.reason).slice(0, 400),
          locked_at: null,
        } as unknown as Partial<EmailJob>);
        skipped++; // not failed yet
      } else {
        await repo.emailJobs.update(job.id, job.organization_id, {
          status: 'failed',
          last_error: redactSecret(outcome.reason).slice(0, 400),
          locked_at: null,
        } as unknown as Partial<EmailJob>);
        if (enrollment) {
          await repo.emailEnrollments.update(enrollment.id, job.organization_id, { status: 'failed', last_error: outcome.reason.slice(0, 400) } as unknown as Partial<EmailSequenceEnrollment>);
        }
        failed++;
      }
    } else {
      // Non-retryable or not_configured -> failed
      const reason = redactSecret(outcome.status === 'failed' ? outcome.reason : 'Provider not configured').slice(0, 400);
      await repo.emailJobs.update(job.id, job.organization_id, {
        status: 'failed',
        last_error: reason,
        locked_at: null,
      } as unknown as Partial<EmailJob>);
      if (enrollment) {
        await repo.emailEnrollments.update(enrollment.id, job.organization_id, { status: 'failed', last_error: reason } as unknown as Partial<EmailSequenceEnrollment>);
      }
      // If provider says suppressed/bounced, also mark preference
      if (/suppressed|bounce|complain/i.test(reason)) {
        const lower = recipient.toLowerCase();
        try {
          const prefs = (await repo.emailPreferences.list(job.organization_id, { limit: 500 })) as unknown as { id: string; email: string }[];
          const found = prefs.find((p) => p.email.toLowerCase() === lower);
          if (found) {
            await repo.emailPreferences.update(found.id, job.organization_id, { opted_out: true, opted_out_at: new Date().toISOString() } as unknown as never);
          } else {
            await repo.emailPreferences.insert({ organization_id: job.organization_id, email: lower, opted_out: true, opted_out_at: new Date().toISOString() } as unknown as never);
          }
          if (enrollment) {
            await repo.emailEnrollments.update(enrollment.id, job.organization_id, { status: 'bounced', last_error: reason } as unknown as Partial<EmailSequenceEnrollment>);
          }
        } catch {}
      }
      failed++;
    }
  }

  return ok({ claimed: claimed.length, sent, failed, skipped, cancelled });
}

// Convenience for tests: list jobs for an org (filtered)
export async function listJobs(
  actor: ActorContext,
  repo: NibrexoRepository,
  opts: { sequenceId?: UUID; status?: string; limit?: number; offset?: number } = {},
) {
  if (!checkPermission(actor, { module: 'email', action: 'view' }).allowed) return permissionDenied(actor, 'view');
  const all = (await repo.emailJobs.list(actor.organizationId, { limit: 500 })) as unknown as EmailJob[];
  let filtered = all;
  if (opts.sequenceId) filtered = filtered.filter((j) => j.sequence_id === opts.sequenceId);
  if (opts.status) filtered = filtered.filter((j) => j.status === opts.status);
  filtered.sort((a, b) => a.run_at.localeCompare(b.run_at));
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  return ok({ jobs: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset });
}
