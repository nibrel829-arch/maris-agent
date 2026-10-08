import { describe, expect, it } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  previewTemplate,
  updateTemplate,
  sendEmail,
  listEmailLogs,
} from '@/server/email/service';
import { createTemplateSchema } from '@/server/email/validation';

function fakeProvider(result: 'sent' | 'failed' | 'not_configured', options: { providerMessageId?: string; reason?: string; retryable?: boolean; id?: string } = {}) {
  const calls: unknown[] = [];
  return {
    name: result === 'sent' ? 'resend' : 'unconfigured',
    isConfigured: () => result !== 'not_configured',
    async send(email: { to: string; subject: string; html: string; idempotencyKey: string }) {
      calls.push(email);
      if (result === 'sent') return { status: 'sent' as const, providerMessageId: options.providerMessageId ?? 're_prov_123', provider: 'resend' };
      if (result === 'not_configured') return { status: 'not_configured' as const, reason: options.reason ?? 'No email provider is configured.' };
      return { status: 'failed' as const, reason: options.reason ?? 'Provider rejected', retryable: options.retryable ?? false };
    },
    calls,
  };
}

describe('Email templates', () => {
  it('creates a template with extracted variables and tenant isolation', async () => {
    const store = repo();
    const owner = actor();
    const result = await createTemplate(
      owner,
      store,
      createTemplateSchema.parse({
        name: 'Welcome',
        category: 'onboarding',
        subject: 'Hi {{client.name}} from {{user.name}}',
        body: 'Welcome {{client.company}} — {{client.name}}',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.organization_id).toBe(TEST_ORG);
    expect(result.data.variables.sort()).toEqual(['client.company', 'client.name', 'user.name'].sort());
    expect(result.data.status).toBe('active');
    expect(result.data.archived).toBe(false);

    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.template.created' && row.entity_id === result.data.id)).toBe(true);

    // Cross-tenant invisibility
    const outsider = actor({ organizationId: OTHER_ORG });
    const foreign = await getTemplate(outsider, store, result.data.id);
    expect(foreign.ok).toBe(false);
  });

  it('rejects malformed placeholders', async () => {
    const store = repo();
    const malformed = await createTemplate(
      actor(),
      store,
      createTemplateSchema.parse({
        name: 'Bad',
        category: 'test',
        subject: 'Hi {{}}',
        body: 'Hello',
      }),
    );
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.error.code).toBe('TEMPLATE_MALFORMED');

    const unclosed = await createTemplate(
      actor(),
      store,
      createTemplateSchema.parse({
        name: 'Bad2',
        category: 'test',
        subject: 'Hi {{client.name}',
        body: 'Hello',
      }),
    );
    expect(unclosed.ok).toBe(false);

    const invalidChar = await createTemplate(
      actor(),
      store,
      createTemplateSchema.parse({
        name: 'Bad3',
        category: 'test',
        subject: 'Hi {{123foo}}',
        body: 'Hello',
      }),
    );
    expect(invalidChar.ok).toBe(false);
  });

  it('searches and filters templates by search, status and category with pagination', async () => {
    const store = repo();
    const owner = actor();
    await createTemplate(owner, store, createTemplateSchema.parse({ name: 'Welcome A', category: 'onboarding', subject: 'Hi', body: 'Hello' }));
    await createTemplate(owner, store, createTemplateSchema.parse({ name: 'Follow up', category: 'nurture', subject: 'Follow', body: 'Hi there' }));
    const draft = await createTemplate(
      owner,
      store,
      createTemplateSchema.parse({ name: 'Draft note', category: 'onboarding', subject: 'Draft', body: '...', status: 'draft' }),
    );
    expect(draft.ok).toBe(true);

    const searched = await listTemplates(owner, store, { search: 'welcome', limit: 10, offset: 0 });
    expect(searched.ok && searched.data.total).toBe(1);

    const byCategory = await listTemplates(owner, store, { category: 'onboarding', limit: 10, offset: 0 });
    expect(byCategory.ok && byCategory.data.total).toBe(2);

    const activeOnly = await listTemplates(owner, store, { status: 'active', limit: 10, offset: 0 });
    expect(activeOnly.ok && activeOnly.data.total).toBe(2);

    const draftOnly = await listTemplates(owner, store, { status: 'draft', limit: 10, offset: 0 });
    expect(draftOnly.ok && draftOnly.data.total).toBe(1);

    const paged = await listTemplates(owner, store, { limit: 1, offset: 0 });
    expect(paged.ok && paged.data.templates.length).toBe(1);
    expect(paged.ok && paged.data.total).toBe(3);
  });

  it('denies creation and updates without permission', async () => {
    const store = repo();
    const viewer = actor({ role: 'client' });
    const denied = await createTemplate(viewer, store, createTemplateSchema.parse({ name: 'X', category: 'c', subject: 's', body: 'b' }));
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.errorClass).toBe('permission');
    expect(await store.emailTemplates.list(TEST_ORG)).toHaveLength(0);

    const owner = actor();
    const created = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'Y', category: 'c', subject: 's', body: 'b' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const noEdit = await updateTemplate(viewer, store, created.data.id, { name: 'Changed' });
    expect(noEdit.ok).toBe(false);

    const crossOrg = actor({ organizationId: OTHER_ORG });
    const cross = await updateTemplate(crossOrg, store, created.data.id, { name: 'Hijacked' });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('updates variables when subject/body change and audits', async () => {
    const store = repo();
    const owner = actor();
    const created = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'T', category: 'c', subject: 'Hi {{client.name}}', body: 'Hello' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.variables).toEqual(['client.name']);

    const updated = await updateTemplate(owner, store, created.data.id, { body: 'New body {{client.company}}' });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.variables.sort()).toEqual(['client.company', 'client.name'].sort());

    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.template.updated')).toBe(true);
  });

  it('deletes templates for owners but not members, never cross-tenant', async () => {
    const store = repo();
    const owner = actor();
    const created = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'Del', category: 'c', subject: 's', body: 'b' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const memberDenied = await deleteTemplate(actor({ role: 'member' }), store, created.data.id);
    expect(memberDenied.ok).toBe(false);

    const outsiderDenied = await deleteTemplate(actor({ organizationId: OTHER_ORG }), store, created.data.id);
    expect(outsiderDenied.ok).toBe(false);

    expect(await store.emailTemplates.get(created.data.id, TEST_ORG)).not.toBeNull();

    const deleted = await deleteTemplate(owner, store, created.data.id);
    expect(deleted.ok).toBe(true);
    expect(await store.emailTemplates.get(created.data.id, TEST_ORG)).toBeNull();

    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.template.deleted')).toBe(true);
  });

  it('previews a template with substitution and reports unresolved', async () => {
    const store = repo();
    const owner = actor();
    const created = await createTemplate(
      owner,
      store,
      createTemplateSchema.parse({
        name: 'P',
        category: 'c',
        subject: 'Hi {{client.name}}',
        body: 'Company {{client.company}} — user {{user.name}}',
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const preview = await previewTemplate(owner, store, created.data.id, { variables: { 'client.name': 'Acme' } });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.subject).toBe('Hi Acme');
    expect(preview.data.body).toBe('Company {{client.company}} — user {{user.name}}');
    expect(preview.data.unresolved.sort()).toEqual(['client.company', 'user.name'].sort());

    const full = await previewTemplate(owner, store, created.data.id, {
      variables: { 'client.name': 'Acme', 'client.company': 'Co', 'user.name': 'Ada' },
    });
    expect(full.ok && full.data.unresolved.length).toBe(0);
    expect(full.ok && full.data.body).toBe('Company Co — user Ada');
  });
});

describe('Email sending', () => {
  it('validates recipient email and template ownership', async () => {
    const store = repo();
    const owner = actor();
    const tpl = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'T', category: 'c', subject: 'Hi {{client.name}}', body: 'Hello {{client.name}}' }));
    expect(tpl.ok).toBe(true);
    if (!tpl.ok) return;

    const badEmail = await sendEmail(owner, store, { to: 'not-an-email', templateId: tpl.data.id, variables: { 'client.name': 'A' } });
    expect(badEmail.ok).toBe(false);

    const cross = await sendEmail(actor({ organizationId: OTHER_ORG }), store, {
      to: 'ok@example.com',
      templateId: tpl.data.id,
      variables: { 'client.name': 'A' },
    });
    expect(cross.ok).toBe(false);
    if (cross.ok) return;
    expect(cross.error.code).toBe('TEMPLATE_NOT_FOUND');
  });

  it('rejects archived/draft templates for sending', async () => {
    const store = repo();
    const owner = actor();
    const draft = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'D', category: 'c', subject: 'Hi', body: 'Hello', status: 'draft' }));
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const denied = await sendEmail(owner, store, { to: 'a@example.com', templateId: draft.data.id, variables: {} });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.code).toBe('TEMPLATE_NOT_SELECTABLE');
  });

  it('requires all template variables and blocks unresolved', async () => {
    const store = repo();
    const owner = actor();
    const tpl = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'T', category: 'c', subject: 'Hi {{client.name}} {{client.company}}', body: 'Hello {{client.name}}' }));
    expect(tpl.ok).toBe(true);
    if (!tpl.ok) return;

    const missing = await sendEmail(owner, store, { to: 'a@example.com', templateId: tpl.data.id, variables: { 'client.name': 'A' } });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('VARIABLES_MISSING');
    expect(missing.error.message).toContain('client.company');
  });

  it('links a client when clientId is valid and tenant-scoped', async () => {
    const store = repo();
    const owner = actor();
    const client = await store.clients.insert({
      organization_id: TEST_ORG,
      name: 'Client A',
      company: null,
      email: 'client@co.test',
      phone: null,
      status: 'active',
      tags: [],
      notes: null,
      created_by: owner.userId,
    });
    const provider = fakeProvider('sent');
    const result = await sendEmail(
      owner,
      store,
      { to: 'client@co.test', subject: 'Hello', body: 'World', clientId: client.id, variables: {}},
      { providerOverride: provider as never, idempotencyKey: 'test-link-1' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.log.client_id).toBe(client.id);
    expect(result.data.log.template_snapshot).toBeDefined();

    const activity = await store.clientActivity.list(TEST_ORG);
    expect(activity.some((row) => row.client_id === client.id && row.kind === 'email')).toBe(true);

    const badClient = await sendEmail(owner, store, {
      to: 'x@example.com',
      subject: 'Hi',
      body: 'Hello',
      clientId: '00000000-0000-0000-0000-000000009999', variables: {}});
    expect(badClient.ok).toBe(false);
  });

  it('sends via provider and stores provider id, snapshot, and audit', async () => {
    const store = repo();
    const owner = actor();
    const tpl = await createTemplate(owner, store, createTemplateSchema.parse({ name: 'T', category: 'c', subject: 'Hi {{client.name}}', body: 'Hello {{client.name}} at {{client.company}}' }));
    expect(tpl.ok).toBe(true);
    if (!tpl.ok) return;

    const provider = fakeProvider('sent', { providerMessageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    const result = await sendEmail(
      owner,
      store,
      { to: 'recipient@example.com', templateId: tpl.data.id, variables: { 'client.name': 'Ada', 'client.company': 'Co' } },
      { providerOverride: provider as never, idempotencyKey: 'send-1' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.providerMessageId).toBe('49a3999c-0ce1-4ea6-ab68-afcd6dc2e794');
    expect(result.data.log.status).toBe('SENT');
    expect(result.data.log.provider_message_id).toBe('49a3999c-0ce1-4ea6-ab68-afcd6dc2e794');
    expect((result.data.log.provider as string)).toBe('resend');
    expect(result.data.log.subject).toBe('Hi Ada');
    expect(result.data.log.body).toBe('Hello Ada at Co');
    expect((result.data.log.template_snapshot as Record<string, unknown>).template_id).toBe(tpl.data.id);

    const logs = await store.emailLogs.list(TEST_ORG);
    expect(logs.length).toBe(1);

    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.sent')).toBe(true);
    // Provider secrets must not appear in audit; provider message id is not a secret and is expected to be stored for tracing.
    expect(JSON.stringify(audit)).not.toContain('re_s3cr3t' as never);
    expect(provider.calls.length).toBe(1);
    expect((provider.calls[0] as { to: string }).to).toBe('recipient@example.com');
  });

  it('reports provider failure with retryability and keeps log as FAILED', async () => {
    const store = repo();
    const owner = actor();
    const provider = fakeProvider('failed', { reason: 'Inbox full', retryable: false });
    const result = await sendEmail(
      owner,
      store,
      { to: 'a@example.com', subject: 'Hi', body: 'Hello', variables: {}},
      { providerOverride: provider as never, idempotencyKey: 'fail-1' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('server');
    expect(result.error.retryable).toBe(false);

    const logs = (await store.emailLogs.list(TEST_ORG)) as unknown as { status: string; error_message: string }[];
    expect(logs[0]!.status).toBe('FAILED');
    expect(logs[0]!.error_message).toContain('Inbox full');

    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.failed')).toBe(true);
  });

  it('handles provider rate-limited failure as retryable', async () => {
    const store = repo();
    const provider = fakeProvider('failed', { reason: 'Provider rate limited the request.', retryable: true });
    const result = await sendEmail(
      actor(),
      store,
      { to: 'a@example.com', subject: 'Hi', body: 'Hello', variables: {}},
      { providerOverride: provider as never, idempotencyKey: 'rl-1' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
  });

  it('reports provider-not-configured as 503 without secrets and without double send', async () => {
    const store = repo();
    const provider = fakeProvider('not_configured');
    const result = await sendEmail(
      actor(),
      store,
      { to: 'a@example.com', subject: 'Hi', body: 'Hello', variables: {}},
      { providerOverride: provider as never, idempotencyKey: 'notconf-1' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMAIL_NOT_CONFIGURED');
    expect(result.error.errorClass).toBe('not_configured');
    const logs = await store.emailLogs.list(TEST_ORG);
    expect(logs[0]!.status).toBe('FAILED');
  });

  it('is idempotent: repeated send with same key returns existing record without second provider call', async () => {
    const store = repo();
    const owner = actor();
    const provider = fakeProvider('sent', { providerMessageId: 're_once' });
    const first = await sendEmail(
      owner,
      store,
      { to: 'dup@example.com', subject: 'Hello', body: 'World', variables: {}},
      { providerOverride: provider as never, idempotencyKey: 'dup-key-42' },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(provider.calls.length).toBe(1);

    const secondProvider = fakeProvider('sent', { providerMessageId: 're_second_should_not_happen' });
    const second = await sendEmail(
      owner,
      store,
      { to: 'dup@example.com', subject: 'Hello', body: 'World', variables: {}},
      { providerOverride: secondProvider as never, idempotencyKey: 'dup-key-42' },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.log.id).toBe(first.data.log.id);
    expect(second.data.providerMessageId).toBe('re_once');
    expect(secondProvider.calls.length).toBe(0);
    expect((await store.emailLogs.list(TEST_ORG)).length).toBe(1);
  });

  it('denies sending without email:send permission (member/client)', async () => {
    const store = repo();
    const member = actor({ role: 'member' });
    const provider = fakeProvider('sent');
    const result = await sendEmail(member, store, { to: 'a@example.com', subject: 'Hi', body: 'Hello', variables: {}}, { providerOverride: provider as never });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('permission');
    expect(await store.emailLogs.list(TEST_ORG)).toHaveLength(0);
    expect(provider.calls.length).toBe(0);
  });

  it('keeps sends tenant-scoped (other org cannot retry same key to hijack)', async () => {
    const store = repo();
    const owner = actor();
    const provider = fakeProvider('sent', { providerMessageId: 're_orgA' });
    const first = await sendEmail(owner, store, { to: 't@example.com', subject: 'Hi', body: 'Hello', variables: {}}, { providerOverride: provider as never, idempotencyKey: 'cross-1' });
    expect(first.ok).toBe(true);

    // Other org with same key should create its own record, not see orgA's
    const other = actor({ organizationId: OTHER_ORG });
    const otherProvider = fakeProvider('sent', { providerMessageId: 're_orgB' });
    const second = await sendEmail(other, store, { to: 't@example.com', subject: 'Hi', body: 'Hello', variables: {}}, { providerOverride: otherProvider as never, idempotencyKey: 'cross-1' });
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.data.log.id).not.toBe(first.data.log.id);
    expect(second.data.providerMessageId).toBe('re_orgB');
    expect(await store.emailLogs.list(TEST_ORG)).toHaveLength(1);
    expect(await store.emailLogs.list(OTHER_ORG)).toHaveLength(1);
  });

  it('redacts provider secrets from stored error and audit', async () => {
    const store = repo();
    const owner = actor();
    const secret = 're_s3cr3t_1234567890abcdef';
    const provider = fakeProvider('failed', { reason: `Auth failed with ${secret}`, retryable: false });
    const result = await sendEmail(owner, store, { to: 'a@example.com', subject: 'Hi', body: 'Hello', variables: {}}, { providerOverride: provider as never, idempotencyKey: 'redact-1' });
    expect(result.ok).toBe(false);
    const logs = (await store.emailLogs.list(TEST_ORG)) as unknown as { error_message: string }[];
    expect(logs[0]!.error_message).not.toContain(secret);
    expect(logs[0]!.error_message).toContain('re_***');
    const audit = await store.activityLogs.list(TEST_ORG);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it('stores direct send without template snapshot correctly and validates direct variables', async () => {
    const store = repo();
    const owner = actor();
    const provider = fakeProvider('sent', { providerMessageId: 're_dir' });
    const result = await sendEmail(
      owner,
      store,
      { to: 'x@example.com', subject: 'Hi {{client.name}}', body: 'Hello {{client.name}}', variables: { 'client.name': 'Bob' } },
      { providerOverride: provider as never, idempotencyKey: 'direct-vars-1' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.log.subject).toBe('Hi Bob');
    expect(result.data.log.body).toBe('Hello Bob');

    const missing = await sendEmail(
      owner,
      store,
      { to: 'x@example.com', subject: 'Hi {{client.name}}', body: 'Hello', variables: {} },
      { providerOverride: provider as never, idempotencyKey: 'direct-vars-2' },
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('VARIABLES_MISSING');
  });
});

describe('Email logs listing', () => {
  it('lists tenant-scoped logs with search and status filter', async () => {
    const store = repo();
    const owner = actor();
    const p1 = fakeProvider('sent', { providerMessageId: 're1' });
    await sendEmail(owner, store, { to: 'a@test.com', subject: 'Hello A', body: 'World', variables: {}}, { providerOverride: p1 as never, idempotencyKey: 'list-1' });
    const p2 = fakeProvider('failed', { reason: 'Nope', retryable: false });
    await sendEmail(owner, store, { to: 'b@test.com', subject: 'Hello B', body: 'World', variables: {}}, { providerOverride: p2 as never, idempotencyKey: 'list-2' });

    const all = await listEmailLogs(owner, store, { limit: 10, offset: 0 });
    expect(all.ok && all.data.total).toBe(2);

    const sentOnly = await listEmailLogs(owner, store, { status: 'SENT', limit: 10, offset: 0 });
    expect(sentOnly.ok && sentOnly.data.total).toBe(1);
    expect(sentOnly.ok && sentOnly.data.logs[0]!.to_email).toBe('a@test.com');

    const search = await listEmailLogs(owner, store, { search: 'b@test.com', limit: 10, offset: 0 });
    expect(search.ok && search.data.total).toBe(1);

    const foreign = await listEmailLogs(actor({ organizationId: OTHER_ORG }), store, { limit: 10, offset: 0 });
    expect(foreign.ok && foreign.data.total).toBe(0);
  });
});
