import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));

vi.mock('@/server/db/supabase', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient, type NibrexoSupabaseClient } from '@/server/db/supabase';
import { GET as workspaceOverview } from '@/app/api/workspace/overview/route';
import { POST as createManagerTask } from '@/app/api/manager/tasks/route';
import { TEST_ORG } from '../helpers/context';

const USER_ID = '00000000-0000-0000-0000-0000000000f1';

interface FakeAuthState {
  user: { id: string; email: string | null } | null;
  membership: { organization_id: string; role: string } | null;
}

function fakeClient(state: FakeAuthState): NibrexoSupabaseClient {
  const responses: Record<string, { data: unknown; error: unknown }> = {
    memberships: { data: state.membership, error: null },
    profiles: { data: null, error: null },
  };

  const client = {
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: async () => responses[table] ?? { data: null, error: null },
      };
      return query;
    },
  };

  return client as unknown as NibrexoSupabaseClient;
}

function signInAs(state: FakeAuthState): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeClient(state));
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
  // The repository layer runs against the deterministic in-memory store; the
  // authorization boundary under test is the real route handler chain.
  process.env.NIBREXO_DATA_BACKEND = 'memory';
  delete process.env.NIBREXO_DEV_AUTH;
});

describe('Authorization flow — login → membership → role → workspace API', () => {
  it('blocks the dashboard API with NO_ORGANIZATION before provisioning (production symptom)', async () => {
    signInAs({ user: { id: USER_ID, email: 'owner@nibrexo.test' }, membership: null });

    const response = await workspaceOverview(
      new Request('https://app.nibrexo.test/api/workspace/overview'),
      undefined,
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NO_ORGANIZATION');
    expect(body.error.message).toBe(
      'Your account is not a member of any organization. Ask an owner or admin to invite you.',
    );
  });

  it('serves the dashboard for the provisioned owner', async () => {
    signInAs({
      user: { id: USER_ID, email: 'owner@nibrexo.test' },
      membership: { organization_id: TEST_ORG, role: 'owner' },
    });

    const response = await workspaceOverview(
      new Request('https://app.nibrexo.test/api/workspace/overview'),
      undefined,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: { role: string } };
    expect(body.ok).toBe(true);
    expect(body.data.role).toBe('owner');
  });

  it('lets the provisioned owner hand a request to the Nibrexo Manager', async () => {
    signInAs({
      user: { id: USER_ID, email: 'owner@nibrexo.test' },
      membership: { organization_id: TEST_ORG, role: 'owner' },
    });

    const response = await createManagerTask(
      new Request('https://app.nibrexo.test/api/manager/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: 'Give me a status report on the current priorities' }),
      }),
      undefined,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { ok: boolean; data: { organizationId: string; state: string } };
    expect(body.ok).toBe(true);
    expect(body.data.organizationId).toBe(TEST_ORG);
    expect(['COMPLETED', 'FAILED', 'WAITING_APPROVAL']).toContain(body.data.state);
  });

  it('keeps the manager API closed without a session', async () => {
    signInAs({ user: null, membership: null });

    const response = await createManagerTask(
      new Request('https://app.nibrexo.test/api/manager/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request: 'Give me a status report' }),
      }),
      undefined,
    );

    expect(response.status).toBe(401);
  });
});
