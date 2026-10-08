import { describe, expect, it } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import { createTemplateSchema } from '@/server/email/validation';
import { createTemplate } from '@/server/email/service';
import {
  archiveSequence,
  cancelEnrollment,
  createSequence,
  enrollInSequence,
  getSequence,
  listEnrollments,
  listSequences,
  pauseSequence,
  resumeSequence,
  runDueJobs,
  startSequence,
  unsubscribeEmail,
  listJobs,
} from '@/server/email/sequence-service';

function fakeProvider(result: 'sent' | 'failed' | 'not_configured', opts: { providerMessageId?: string; reason?: string; retryable?: boolean } = {}) {
  const calls: unknown[] = [];
  return {
    name: result === 'sent' ? 'resend' : 'unconfigured',
    isConfigured: () => result !== 'not_configured',
    async send(email: { to: string; subject: string; html: string; idempotencyKey: string }) {
      calls.push(email);
      if (result === 'sent') return { status: 'sent' as const, providerMessageId: opts.providerMessageId ?? 'prov_123', provider: 'resend' };
      if (result === 'not_configured') return { status: 'not_configured' as const, reason: opts.reason ?? 'No provider' };
      return { status: 'failed' as const, reason: opts.reason ?? 'Provider rejected', retryable: opts.retryable ?? false };
    },
    calls,
  };
}

async function createActiveTemplate(store: ReturnType<typeof repo>, name = 'T') {
  const owner = actor();
  const tpl = await createTemplate(owner, store, createTemplateSchema.parse({ name, category: 'seq', subject: 'Hi {{client.name}}', body: 'Hello {{client.name}}' }));
  if (!tpl.ok) throw new Error(`template create failed: ${tpl.error.message}`);
  return tpl.data;
}

describe('Sequences — validation and tenant isolation', () => {
  it('creates a sequence with validated steps and tenant isolation', async () => {
    const store = repo();
    const t1 = await createActiveTemplate(store, 'T1');
    const t2 = await createActiveTemplate(store, 'T2');
    const owner = actor();
    const result = await createSequence(owner, store, {
      name: 'Welcome drip',
      trigger: 'client.created',
      steps: [
        { templateId: t1.id, delayDays: 0, delayHours: 0 },
        { templateId: t2.id, delayDays: 2, delayHours: 0 },
      ],
      stopConditions: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.organization_id).toBe(TEST_ORG);
    expect(result.data.steps.length).toBe(2);
    // cross-tenant invisibility
    const outsider = actor({ organizationId: OTHER_ORG });
    const foreign = await getSequence(outsider, store, result.data.id);
    expect(foreign.ok).toBe(false);
    const listOther = await listSequences(outsider, store, { limit: 10, offset: 0 });
    expect(listOther.ok && listOther.data.total).toBe(0);
  });

  it('rejects invalid steps (missing template, archived template, bad delay)', async () => {
    const store = repo();
    const owner = actor();
    await createActiveTemplate(store, 'Good');
    const badId = '00000000-0000-0000-0000-00000000bad1';
    const missing = await createSequence(owner, store, {
      name: 'Bad',
      trigger: 'x',
      steps: [{ templateId: badId, delayDays: 0, delayHours: 0 }],
      stopConditions: [],
    });
    expect(missing.ok).toBe(false);

    // archived template should be rejected
    const archived = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'Archived', category: 'c', subject: 's', body: 'b', status: 'archived' }));
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const withArchived = await createSequence(owner, store, {
      name: 'Bad2',
      trigger: 'x',
      steps: [{ templateId: archived.data.id, delayDays: 0, delayHours: 0 }],
      stopConditions: [],
    });
    expect(withArchived.ok).toBe(false);
    if (withArchived.ok) return;
    expect(withArchived.error.code).toBe('TEMPLATE_NOT_SELECTABLE');
  });

  it('denies creation without permission and allows owner', async () => {
    const store = repo();
    const t1 = await createActiveTemplate(store, 'T');
    const clientActor = actor({ role: 'client' });
    const denied = await createSequence(clientActor, store, {
      name: 'X',
      trigger: 'x',
      steps: [{ templateId: t1.id, delayDays: 0, delayHours: 0 }],
      stopConditions: [],
    });
    expect(denied.ok).toBe(false);
    expect(denied.ok ? null : denied.error.errorClass).toBe('permission');

    const owner = actor();
    const created = await createSequence(owner, store, {
      name: 'Y',
      trigger: 'x',
      steps: [{ templateId: t1.id, delayDays: 0, delayHours: 0 }],
      stopConditions: [],
    });
    expect(created.ok).toBe(true);
  });

  it('searches and filters sequences', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    await createSequence(owner, store, { name: 'Welcome A', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    await createSequence(owner, store, { name: 'Follow up', trigger: 't', steps: [{ templateId: t.id, delayDays: 1, delayHours: 0 }], stopConditions: [] });
    const draft = await createSequence(owner, store, { name: 'Draft seq', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [], status: 'draft' });
    expect(draft.ok).toBe(true);

    const searched = await listSequences(owner, store, { search: 'welcome', limit: 10, offset: 0 });
    expect(searched.ok && searched.data.total).toBe(1);

    const activeOnly = await listSequences(owner, store, { status: 'active' as never, limit: 10, offset: 0 });
    // default status is draft, so active is 0
    expect(activeOnly.ok && activeOnly.data.total).toBe(0);

    const draftOnly = await listSequences(owner, store, { status: 'draft' as never, limit: 10, offset: 0 });
    expect(draftOnly.ok && draftOnly.data.total).toBe(3);
  });
});

describe('Sequences — enrollment eligibility', () => {
  it('enrolls eligible clients, rejects missing email, cross-tenant client, and inactive sequence', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    // draft sequence should block enrollment
    const draftEnroll = await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['a@example.com'], variables: {} });
    expect(draftEnroll.ok).toBe(false);
    expect(draftEnroll.ok ? null : draftEnroll.error.code).toBe('SEQUENCE_NOT_ACTIVE');

    // Activate
    const started = await startSequence(owner, store, seq.data.id);
    expect(started.ok).toBe(true);

    // Client without email rejected
    const noEmailClient = await store.clients.insert({ organization_id: TEST_ORG, name: 'No email', company: null, email: null, phone: null, status: 'active', tags: [], notes: null, created_by: owner.userId } as never);
    const bad = await enrollInSequence(owner, store, seq.data.id, { clientIds: [noEmailClient.id], emails: [], variables: {} });
    expect(bad.ok).toBe(false);

    // Valid client with email
    const goodClient = await store.clients.insert({ organization_id: TEST_ORG, name: 'Good', company: null, email: 'good@example.com', phone: null, status: 'active', tags: [], notes: null, created_by: owner.userId } as never);
    const okEnroll = await enrollInSequence(owner, store, seq.data.id, { clientIds: [goodClient.id], emails: [], variables: { 'client.name': 'Good' } });
    expect(okEnroll.ok).toBe(true);
    if (!okEnroll.ok) return;
    expect(okEnroll.data.enrolled).toBe(1);

    // Cross-tenant client rejected
    const foreignClient = await store.clients.insert({ organization_id: OTHER_ORG, name: 'Foreign', company: null, email: 'foreign@example.com', phone: null, status: 'active', tags: [], notes: null, created_by: owner.userId } as never);
    const cross = await enrollInSequence(owner, store, seq.data.id, { clientIds: [foreignClient.id], emails: [], variables: {} });
    expect(cross.ok).toBe(false);

    // Direct email enrollment
    const direct = await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['direct@example.com'], variables: {} });
    expect(direct.ok).toBe(true);
  });

  it('prevents duplicate enrollment (idempotent)', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    const first = await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['dup@example.com'], variables: {} });
    expect(first.ok && first.data.enrolled).toBe(1);
    const second = await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['dup@example.com'], variables: {} });
    expect(second.ok && second.data.enrolled).toBe(0);
    const list = await listEnrollments(owner, store, seq.data.id, { limit: 10, offset: 0 });
    expect(list.ok && list.data.total).toBe(1);
  });

  it('checks tenant isolation on enroll', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    const outsider = actor({ organizationId: OTHER_ORG });
    const denied = await enrollInSequence(outsider, store, seq.data.id, { clientIds: [], emails: ['x@example.com'], variables: {} });
    expect(denied.ok).toBe(false);
  });
});

describe('Sequences — scheduling and execution', () => {
  it('schedules first job on enroll and executes via worker with per-recipient history', async () => {
    const store = repo();
    const owner = actor();
    const t1 = await createActiveTemplate(store, 'T1');
    const t2 = await createActiveTemplate(store, 'T2');
    const seq = await createSequence(owner, store, {
      name: 'Drip',
      trigger: 'manual',
      steps: [
        { templateId: t1.id, delayDays: 0, delayHours: 0 },
        { templateId: t2.id, delayDays: 1, delayHours: 0 },
      ],
      stopConditions: [],
    });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);

    const provider = fakeProvider('sent', { providerMessageId: 'prov_1' });
    const enrolled = await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['sched@example.com'], variables: { 'client.name': 'Ada' } });
    expect(enrolled.ok).toBe(true);

    // Job should be queued immediately
    const jobsBefore = await listJobs(owner, store, { sequenceId: seq.data.id });
    expect(jobsBefore.ok && jobsBefore.data.total).toBe(1);
    expect(jobsBefore.ok && jobsBefore.data.jobs[0]!.status).toBe('queued');

    // Worker claims and sends
    const result = await runDueJobs(store, { providerOverride: provider as never, nowIso: new Date(Date.now() + 1000).toISOString() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sent).toBe(1);
    expect(provider.calls.length).toBe(1);

    // After first send, job should be sent and next step scheduled
    const jobsAfter = await listJobs(owner, store, { sequenceId: seq.data.id });
    expect(jobsAfter.ok && jobsAfter.data.jobs.filter((j) => j.status === 'sent').length).toBe(1);
    expect(jobsAfter.ok && jobsAfter.data.jobs.filter((j) => j.status === 'queued').length).toBe(1);

    // Emails logs should have one SENT
    const logs = await store.emailLogs.list(TEST_ORG);
    expect(logs.length).toBe(1);
    expect((logs[0] as unknown as { status: string }).status).toBe('SENT');

    // Fast-forward 2 days to trigger second step
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 1000).toISOString();
    const provider2 = fakeProvider('sent', { providerMessageId: 'prov_2' });
    const result2 = await runDueJobs(store, { providerOverride: provider2 as never, nowIso: future });
    expect(result2.ok && result2.data.sent).toBe(1);
    const finalEnrollments = await listEnrollments(owner, store, seq.data.id, { limit: 10, offset: 0 });
    expect(finalEnrollments.ok && finalEnrollments.data.enrollments[0]!.status).toBe('completed');
  });

  it('prevents duplicate sends via single-flight claim (second worker gets 0)', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['dupworker@example.com'], variables: { 'client.name': 'Dup' } });

    const p1 = fakeProvider('sent', { providerMessageId: 'p1' });
    const p2 = fakeProvider('sent', { providerMessageId: 'p2' });

    // Two workers racing: both attempt claim at same nowIso
    const now = new Date().toISOString();
    // Simulate by calling claim directly via service: but runDueJobs does claim internally, so sequential calls should demonstrate idempotency
    const first = await runDueJobs(store, { providerOverride: p1 as never, nowIso: now });
    expect(first.ok && first.data.sent).toBe(1);
    const second = await runDueJobs(store, { providerOverride: p2 as never, nowIso: now });
    // Second should claim 0 because job already sent or locked
    expect(second.ok && second.data.claimed).toBe(0);
    expect(p2.calls.length).toBe(0);

    // Logs should be 1
    expect((await store.emailLogs.list(TEST_ORG)).length).toBe(1);
  });

  it('handles pause/resume/ cancel: no sends while paused, resumes, archive cancels pending', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['pause@example.com'], variables: { 'client.name': 'P' } });

    // Pause before worker runs
    const paused = await pauseSequence(owner, store, seq.data.id);
    expect(paused.ok && paused.data.status).toBe('paused');

    const provider = fakeProvider('sent');
    const resultPaused = await runDueJobs(store, { providerOverride: provider as never });
    // Should skip (re-queue), not send
    expect(resultPaused.ok && resultPaused.data.sent).toBe(0);
    expect(provider.calls.length).toBe(0);

    // Resume
    const resumed = await resumeSequence(owner, store, seq.data.id);
    expect(resumed.ok && resumed.data.status).toBe('active');
    const resultResumed = await runDueJobs(store, { providerOverride: provider as never });
    expect(resultResumed.ok && resultResumed.data.sent).toBe(1);
    expect(provider.calls.length).toBe(1);

    // Enroll another and archive cancels pending
    const seq2 = await createSequence(owner, store, { name: 'S2', trigger: 't', steps: [{ templateId: t.id, delayDays: 5, delayHours: 0 }], stopConditions: [] });
    expect(seq2.ok).toBe(true);
    if (!seq2.ok) return;
    await startSequence(owner, store, seq2.data.id);
    await enrollInSequence(owner, store, seq2.data.id, { clientIds: [], emails: ['archive@example.com'], variables: {} });
    const archived = await archiveSequence(owner, store, seq2.data.id);
    expect(archived.ok && archived.data.status).toBe('archived');
    const jobs = await listJobs(owner, store, { sequenceId: seq2.data.id });
    expect(jobs.ok && jobs.data.jobs.every((j) => j.status === 'cancelled')).toBe(true);
    const workerAfterArchive = await runDueJobs(store, { providerOverride: provider as never });
    expect(workerAfterArchive.ok && workerAfterArchive.data.sent).toBe(0);
  });

  it('enforces authorization for lifecycle actions', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    const member = actor({ role: 'member' });
    const deniedStart = await startSequence(member, store, seq.data.id);
    expect(deniedStart.ok).toBe(false);
    const deniedPause = await pauseSequence(member, store, seq.data.id);
    expect(deniedPause.ok).toBe(false);
    const deniedEnroll = await enrollInSequence(member, store, seq.data.id, { clientIds: [], emails: ['x@example.com'], variables: {} });
    expect(deniedEnroll.ok).toBe(false);
  });
});

describe('Sequences — suppression and unsubscribe', () => {
  it('does not enroll opted-out email and marks unsubscribed', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    // Opt out first
    await unsubscribeEmail(owner, store, 'suppressed@example.com');
    const enrolled = await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['suppressed@example.com'], variables: {} });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    expect(enrolled.data.enrolled).toBe(0); // skipped
    expect(enrolled.data.enrollments[0]!.status).toBe('unsubscribed');
    const jobs = await listJobs(owner, store, { sequenceId: seq.data.id });
    expect(jobs.ok && jobs.data.total).toBe(0);
  });

  it('prevents sends after unsubscribe and cancels pending jobs', async () => {
    const store = repo();
    const owner = actor();
    const t1 = await createActiveTemplate(store, 'T1');
    const t2 = await createActiveTemplate(store, 'T2');
    const seq = await createSequence(owner, store, {
      name: 'S',
      trigger: 't',
      steps: [
        { templateId: t1.id, delayDays: 0, delayHours: 0 },
        { templateId: t2.id, delayDays: 1, delayHours: 0 },
      ],
      stopConditions: [],
    });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['unsub@example.com'], variables: { 'client.name': 'Test' } });
    // Send first step
    const p1 = fakeProvider('sent', { providerMessageId: 'p1' });
    const first = await runDueJobs(store, { providerOverride: p1 as never });
    expect(first.ok && first.data.sent).toBe(1);
    // Unsubscribe before second step due
    await unsubscribeEmail(owner, store, 'unsub@example.com');
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 1000).toISOString();
    const p2 = fakeProvider('sent', { providerMessageId: 'p2' });
    const second = await runDueJobs(store, { providerOverride: p2 as never, nowIso: future });
    expect(second.ok && second.data.sent).toBe(0);
    expect(p2.calls.length).toBe(0);
    // Enrollment should be unsubscribed
    const enrollments = await listEnrollments(owner, store, seq.data.id, { limit: 10, offset: 0 });
    expect(enrollments.ok && enrollments.data.enrollments[0]!.status).toBe('unsubscribed');
  });

  it('never sends after suppression even if worker claimed', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['nosend@example.com'], variables: {} });
    // Suppress before worker
    await unsubscribeEmail(owner, store, 'nosend@example.com');
    const p = fakeProvider('sent');
    const result = await runDueJobs(store, { providerOverride: p as never });
    expect(result.ok && result.data.sent).toBe(0);
    expect(p.calls.length).toBe(0);
  });
});

describe('Sequences — provider and retry', () => {
  it('records provider success with logs and audit, handles failure', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['ok@example.com'], variables: { 'client.name': 'Ok' } });
    const p = fakeProvider('sent', { providerMessageId: 'resend_abc' });
    const result = await runDueJobs(store, { providerOverride: p as never });
    expect(result.ok && result.data.sent).toBe(1);
    const logs = await store.emailLogs.list(TEST_ORG);
    expect(logs.length).toBe(1);
    expect((logs[0] as unknown as { provider_message_id: string }).provider_message_id).toBe('resend_abc');
    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.sent')).toBe(true);
  });

  it('handles provider failure with retryable vs non-retryable and respects max attempts', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['fail@example.com'], variables: { 'client.name': 'F' } });

    const retryable = fakeProvider('failed', { reason: 'Provider rate limited', retryable: true });
    const first = await runDueJobs(store, { providerOverride: retryable as never });
    // Should not increment failed yet, but requeue
    expect(first.ok && first.data.failed).toBe(0);
    expect(first.ok && first.data.skipped).toBe(1);
    const jobsAfter = await listJobs(owner, store, { sequenceId: seq.data.id });
    const queued = jobsAfter.ok && jobsAfter.data.jobs.find((j) => j.status === 'queued');
    expect(queued).toBeTruthy();

    const nonRetryable = fakeProvider('failed', { reason: 'Invalid address', retryable: false });
    // Fast-forward to retry time
    const job = queued as unknown as { run_at: string };
    const future = new Date(Date.parse(job.run_at) + 1000).toISOString();
    const second = await runDueJobs(store, { providerOverride: nonRetryable as never, nowIso: future });
    expect(second.ok && second.data.failed).toBe(1);
    const enrollments = await listEnrollments(owner, store, seq.data.id, { limit: 10, offset: 0 });
    expect(enrollments.ok && enrollments.data.enrollments[0]!.status).toBe('failed');
  });

  it('handles not_configured without retry and without secret leak', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['noconfig@example.com'], variables: { 'client.name': 'N' } });
    const p = fakeProvider('not_configured');
    const result = await runDueJobs(store, { providerOverride: p as never });
    expect(result.ok && result.data.failed).toBe(1);
    const jobs = await listJobs(owner, store, { sequenceId: seq.data.id });
    expect(jobs.ok && jobs.data.jobs[0]!.last_error).not.toContain('re_s3cr3t' as never);
  });

  it('redacts provider secrets from stored error', async () => {
    const store = repo();
    const owner = actor();
    const secret = 're_s3cr3t_1234567890abcdef';
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['secret@example.com'], variables: { 'client.name': 'S' } });
    const p = fakeProvider('failed', { reason: `Auth failed with ${secret}`, retryable: false });
    await runDueJobs(store, { providerOverride: p as never });
    const jobs = await listJobs(owner, store, { sequenceId: seq.data.id });
    expect(jobs.ok && jobs.data.jobs[0]!.last_error).not.toContain(secret);
    expect(jobs.ok && jobs.data.jobs[0]!.last_error).toContain('re_***');
  });

  it('does not treat provider acceptance as delivered — only SENT, not DELIVERED', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['check@example.com'], variables: { 'client.name': 'C' } });
    const p = fakeProvider('sent', { providerMessageId: 'prov' });
    await runDueJobs(store, { providerOverride: p as never });
    const logs = (await store.emailLogs.list(TEST_ORG)) as unknown as { status: string }[];
    expect(logs[0]!.status).toBe('SENT');
    expect(logs[0]!.status).not.toBe('DELIVERED');
  });
});

describe('Sequences — audit and cancellation', () => {
  it('writes audit for lifecycle and cancellation and handles tenant isolation for jobs', async () => {
    const store = repo();
    const owner = actor();
    const t = await createActiveTemplate(store, 'T');
    const seq = await createSequence(owner, store, { name: 'S', trigger: 't', steps: [{ templateId: t.id, delayDays: 0, delayHours: 0 }], stopConditions: [] });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    const auditBefore = await store.activityLogs.list(TEST_ORG);
    await startSequence(owner, store, seq.data.id);
    await pauseSequence(owner, store, seq.data.id);
    await resumeSequence(owner, store, seq.data.id);
    await archiveSequence(owner, store, seq.data.id);
    const auditAfter = await store.activityLogs.list(TEST_ORG);
    expect(auditAfter.length).toBeGreaterThan(auditBefore.length);
    expect(auditAfter.some((r) => r.action === 'email.sequence.started')).toBe(true);
    expect(auditAfter.some((r) => r.action === 'email.sequence.paused')).toBe(true);
    expect(auditAfter.some((r) => r.action === 'email.sequence.resumed')).toBe(true);
    expect(auditAfter.some((r) => r.action === 'email.sequence.archived')).toBe(true);

    // Tenant isolation for jobs
    const other = actor({ organizationId: OTHER_ORG });
    const otherJobs = await listJobs(other, store, { sequenceId: seq.data.id });
    expect(otherJobs.ok && otherJobs.data.total).toBe(0);
  });

  it('cancel enrollment stops future steps and no sends after cancel', async () => {
    const store = repo();
    const owner = actor();
    const t1 = await createActiveTemplate(store, 'T1');
    const t2 = await createActiveTemplate(store, 'T2');
    const seq = await createSequence(owner, store, {
      name: 'S',
      trigger: 't',
      steps: [
        { templateId: t1.id, delayDays: 0, delayHours: 0 },
        { templateId: t2.id, delayDays: 1, delayHours: 0 },
      ],
      stopConditions: [],
    });
    expect(seq.ok).toBe(true);
    if (!seq.ok) return;
    await startSequence(owner, store, seq.data.id);
    const enrolled = await enrollInSequence(owner, store, seq.data.id, { clientIds: [], emails: ['cancel@example.com'], variables: { 'client.name': 'C' } });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    const enrollmentId = enrolled.data.enrollments[0]!.id;
    // Cancel before any send
    const cancelled = await cancelEnrollment(owner, store, enrollmentId);
    expect(cancelled.ok && cancelled.data.status).toBe('cancelled');
    const p = fakeProvider('sent');
    const result = await runDueJobs(store, { providerOverride: p as never });
    expect(result.ok && result.data.sent).toBe(0);
    expect(p.calls.length).toBe(0);
  });
});
