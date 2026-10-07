import { describe, expect, it } from 'vitest';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';
import {
  addClientNote,
  createClient,
  getClientDetail,
  listClients,
  updateClient,
} from '@/server/clients/service';
import {
  clientListQuerySchema,
  createClientSchema,
  updateClientSchema,
} from '@/server/clients/validation';

/**
 * Phase 5 CRM lifecycle through the real path:
 * validate input -> authorize -> tenant-scoped store -> timeline + audit.
 * The store here is the in-memory backend; Supabase RLS underneath provides
 * the same tenant boundary in production (0004/0005, unchanged by 0006).
 */
describe('Clients/CRM lifecycle', () => {
  it('runs create -> list -> detail -> update -> note with tenant isolation', async () => {
    const store = repo();
    const owner = actor();
    const otherOwner = actor({ organizationId: OTHER_ORG });

    const first = await createClient(
      owner,
      store,
      createClientSchema.parse({ name: 'Acme Clinic', company: 'Acme', status: 'lead' }),
    );
    const second = await createClient(
      owner,
      store,
      createClientSchema.parse({
        name: 'Beta Dental',
        email: 'hello@beta.test',
        phone: '+44 20 7946 0000',
        status: 'prospect',
      }),
    );
    const third = await createClient(
      owner,
      store,
      createClientSchema.parse({ name: 'Acme Labs', status: 'active' }),
    );
    const foreign = await createClient(
      otherOwner,
      store,
      createClientSchema.parse({ name: 'Other Org Client', status: 'active' }),
    );
    expect(first.ok && second.ok && third.ok && foreign.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok || !foreign.ok) return;

    // List: full directory, newest first, with last-activity attached.
    const all = await listClients(
      owner,
      store,
      clientListQuerySchema.parse({ limit: '20', offset: '0' }),
    );
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.data.total).toBe(3);
    // Same-millisecond inserts share a timestamp, so order is not asserted.
    expect(all.data.clients.map((client) => client.name).sort()).toEqual([
      'Acme Clinic',
      'Acme Labs',
      'Beta Dental',
    ]);
    expect(
      all.data.clients.every((client) => typeof client.last_activity_at === 'string'),
    ).toBe(true);

    // Search narrows to matching records only.
    const searched = await listClients(
      owner,
      store,
      clientListQuerySchema.parse({ search: 'acme' }),
    );
    expect(searched.ok).toBe(true);
    if (!searched.ok) return;
    expect(searched.data.total).toBe(2);

    // Status filter.
    const active = await listClients(
      owner,
      store,
      clientListQuerySchema.parse({ status: 'active' }),
    );
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(active.data.clients.map((client) => client.name)).toEqual(['Acme Labs']);

    // Pagination slices the filtered set and reports the total.
    const page = await listClients(
      owner,
      store,
      clientListQuerySchema.parse({ limit: '2', offset: '2' }),
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.data.total).toBe(3);
    expect(page.data.clients).toHaveLength(1);

    // Detail: client plus its own timeline only.
    const detail = await getClientDetail(owner, store, first.data.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.client.name).toBe('Acme Clinic');
    expect(
      detail.data.activity.every((entry) => entry.client_id === first.data.id),
    ).toBe(true);

    // Update: fields change, tenancy cannot move, timeline grows.
    const updated = await updateClient(
      owner,
      store,
      first.data.id,
      updateClientSchema.parse({ status: 'completed', notes: 'Engagement finished.' }),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.status).toBe('completed');
    expect(updated.data.organization_id).toBe(TEST_ORG);

    const noted = await addClientNote(owner, store, first.data.id, {
      subject: 'Closing summary sent',
    });
    expect(noted.ok).toBe(true);

    const after = await getClientDetail(owner, store, first.data.id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.activity.length).toBeGreaterThanOrEqual(3);

    // Tenant isolation: the other organization sees only its own record and
    // cannot touch this organization's clients.
    const foreignList = await listClients(
      otherOwner,
      store,
      clientListQuerySchema.parse({}),
    );
    expect(foreignList.ok).toBe(true);
    if (!foreignList.ok) return;
    expect(foreignList.data.clients.map((client) => client.name)).toEqual([
      'Other Org Client',
    ]);

    const crossRead = await getClientDetail(otherOwner, store, first.data.id);
    expect(crossRead.ok).toBe(false);
    const crossUpdate = await updateClient(
      otherOwner,
      store,
      first.data.id,
      updateClientSchema.parse({ name: 'Hijacked' }),
    );
    expect(crossUpdate.ok).toBe(false);
  });

  it('rejects invalid input before touching the store', async () => {
    const store = repo();

    expect(() => createClientSchema.parse({ name: '', status: 'active' })).toThrow();
    expect(() =>
      createClientSchema.parse({ name: 'X', email: 'not-an-email' }),
    ).toThrow();
    expect(() =>
      updateClientSchema.parse({ phone: '12' }),
    ).toThrow('Enter a valid phone number.');

    expect(await store.clients.list(TEST_ORG)).toEqual([]);
  });
});
