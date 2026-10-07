import { describe, expect, it } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import {
  addClientNote,
  createClient,
  getClientDetail,
  updateClient,
} from '@/server/clients/service';
import { createClientSchema, updateClientSchema } from '@/server/clients/validation';

const input = (overrides: Record<string, unknown> = {}) =>
  createClientSchema.parse({ name: 'Acme Clinic', ...overrides });

describe('Clients service', () => {
  it('creates a client scoped to the actor organization and logs creation', async () => {
    const store = repo();
    const owner = actor();
    const result = await createClient(
      owner,
      store,
      input({
        company: 'Acme',
        email: 'hello@acme.test',
        phone: '+1 555 010 2030',
        status: 'prospect',
        notes: 'First contact made.',
        tags: ['vip'],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.organization_id).toBe(TEST_ORG);
    expect(result.data.created_by).toBe(owner.userId);
    expect(result.data.phone).toBe('+1 555 010 2030');
    expect(result.data.status).toBe('prospect');

    const timeline = await store.clientActivity.list(TEST_ORG, { limit: 10 });
    expect(
      timeline.some(
        (entry) => entry.client_id === result.data.id && entry.kind === 'lead_created',
      ),
    ).toBe(true);

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(
      audit.some(
        (entry) => entry.action === 'client.created' && entry.entity_id === result.data.id,
      ),
    ).toBe(true);
  });

  it('denies creation without the clients:create permission and writes nothing', async () => {
    const store = repo();
    const viewer = actor({ role: 'client' });
    const result = await createClient(viewer, store, input());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PERMISSION_DENIED');
    expect(await store.clients.list(TEST_ORG)).toEqual([]);
    expect(await store.clientActivity.list(TEST_ORG)).toEqual([]);
  });

  it('denies edits and notes without the clients:edit permission', async () => {
    const store = repo();
    const created = await createClient(actor(), store, input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const viewer = actor({ role: 'client' });
    const updated = await updateClient(
      viewer,
      store,
      created.data.id,
      updateClientSchema.parse({ name: 'Changed' }),
    );
    expect(updated.ok).toBe(false);

    const noted = await addClientNote(viewer, store, created.data.id, {
      subject: 'Sneaky note',
    });
    expect(noted.ok).toBe(false);

    const kept = await store.clients.get(created.data.id, TEST_ORG);
    expect(kept?.name).toBe('Acme Clinic');
  });

  it('prevents cross-organization reads, updates and notes', async () => {
    const store = repo();
    const created = await createClient(actor(), store, input({ name: 'Org A client' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const outsider = actor({ organizationId: OTHER_ORG });

    const read = await getClientDetail(outsider, store, created.data.id);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.error.code).toBe('CLIENT_NOT_FOUND');

    const updated = await updateClient(
      outsider,
      store,
      created.data.id,
      updateClientSchema.parse({ name: 'Hijacked' }),
    );
    expect(updated.ok).toBe(false);

    const noted = await addClientNote(outsider, store, created.data.id, {
      subject: 'Hijacked note',
    });
    expect(noted.ok).toBe(false);

    const kept = await store.clients.get(created.data.id, TEST_ORG);
    expect(kept?.name).toBe('Org A client');
    expect(await store.clients.list(OTHER_ORG)).toEqual([]);
  });

  it('updates editable fields and logs status changes on the timeline', async () => {
    const store = repo();
    const owner = actor();
    const created = await createClient(owner, store, input({ status: 'lead' }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await updateClient(
      owner,
      store,
      created.data.id,
      updateClientSchema.parse({ status: 'active', phone: '+1 555 999 0000' }),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.status).toBe('active');
    expect(updated.data.phone).toBe('+1 555 999 0000');
    expect(updated.data.organization_id).toBe(TEST_ORG);

    const timeline = await store.clientActivity.list(TEST_ORG, { limit: 10 });
    const change = timeline.find(
      (entry) => entry.client_id === created.data.id && entry.kind === 'status_change',
    );
    expect(change?.subject).toBe('Status changed from lead to active');

    const audit = await store.activityLogs.list(TEST_ORG, { limit: 10 });
    expect(audit.some((entry) => entry.action === 'client.updated')).toBe(true);
  });

  it('returns NOT_FOUND for unknown clients without leaking tenancy', async () => {
    const store = repo();
    const missing = await getClientDetail(
      actor(),
      store,
      '00000000-0000-0000-0000-000000009999',
    );
    expect(missing.ok).toBe(false);
  });

  it('appends notes to the same-organization timeline only', async () => {
    const store = repo();
    const owner = actor();
    const created = await createClient(owner, store, input());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const noted = await addClientNote(owner, store, created.data.id, {
      subject: 'Kickoff call',
      body: 'Discussed onboarding.',
    });
    expect(noted.ok).toBe(true);

    const detail = await getClientDetail(owner, store, created.data.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.activity.some((entry) => entry.subject === 'Kickoff call')).toBe(true);
  });
});
