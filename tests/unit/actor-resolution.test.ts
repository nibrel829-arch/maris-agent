import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));

vi.mock('@/server/db/supabase', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient, type NibrexoSupabaseClient } from '@/server/db/supabase';
import { resolveActor, resolveActorFromToken } from '@/server/auth/actor';
import { NO_ORGANIZATION_MESSAGE } from '@/server/auth/authorization';
import { TEST_ORG } from '../helpers/context';

const USER_ID = '00000000-0000-0000-0000-0000000000f1';

interface FakeState {
  user: { id: string; email: string | null } | null;
  userError?: { message: string } | null;
  membership?: { organization_id: string; role: string } | null;
  membershipError?: { message: string } | null;
  profile?: { full_name: string | null } | null;
}

/**
 * Minimal stand-in for the cookie-bound Supabase client. It mirrors the exact
 * query chains `resolveActor()` uses, so the mocked path exercises the real
 * resolution code instead of a re-implementation.
 */
function fakeClient(state: FakeState): NibrexoSupabaseClient {
  const responses: Record<string, { data: unknown; error: unknown }> = {
    memberships: { data: state.membership ?? null, error: state.membershipError ?? null },
    profiles: { data: state.profile ?? null, error: null },
  };

  const client = {
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: state.userError ?? null }),
    },
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

function mockClient(state: FakeState): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fakeClient(state));
}

beforeEach(() => {
  vi.mocked(createSupabaseServerClient).mockReset();
});

describe('resolveActor — the production authorization path', () => {
  it('reports the production symptom when the Auth user has no membership', async () => {
    // This is the state the deployed app is in: Supabase Auth works, the user
    // exists, and no memberships row links it to an organization.
    mockClient({ user: { id: USER_ID, email: 'owner@nibrexo.test' }, membership: null });

    const result = await resolveActor();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_ORGANIZATION');
    expect(result.error.message).toBe(NO_ORGANIZATION_MESSAGE);
  });

  it('resolves the owner actor after provisioning attaches the membership', async () => {
    mockClient({
      user: { id: USER_ID, email: 'owner@nibrexo.test' },
      membership: { organization_id: TEST_ORG, role: 'owner' },
      profile: { full_name: 'Nibrexo Owner' },
    });

    const result = await resolveActor();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      userId: USER_ID,
      organizationId: TEST_ORG,
      role: 'owner',
      email: 'owner@nibrexo.test',
      fullName: 'Nibrexo Owner',
      isDevIdentity: false,
    });
  });

  it('resolves an admin membership', async () => {
    mockClient({
      user: { id: USER_ID, email: 'admin@nibrexo.test' },
      membership: { organization_id: TEST_ORG, role: 'admin' },
      profile: null,
    });

    const result = await resolveActor();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.role).toBe('admin');
    expect(result.data.fullName).toBeNull();
  });

  it('distinguishes a database read failure from a missing membership', async () => {
    mockClient({
      user: { id: USER_ID, email: 'owner@nibrexo.test' },
      membership: null,
      membershipError: { message: 'relation "public.memberships" does not exist' },
    });

    const result = await resolveActor();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MEMBERSHIP_LOOKUP_FAILED');
    expect(result.error.errorClass).toBe('server');
    expect(result.error.message).not.toBe(NO_ORGANIZATION_MESSAGE);
  });

  it('reports UNAUTHENTICATED without a verified session', async () => {
    mockClient({ user: null });

    const result = await resolveActor();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNAUTHENTICATED');
    expect(result.error.errorClass).toBe('auth');
  });

  it('resolves a token-authenticated actor for job runners', async () => {
    mockClient({
      user: { id: USER_ID, email: 'owner@nibrexo.test' },
      membership: { organization_id: TEST_ORG, role: 'owner' },
    });

    const result = await resolveActorFromToken('test-token');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.role).toBe('owner');
    expect(result.data.organizationId).toBe(TEST_ORG);
  });

  it('reports NO_ORGANIZATION for a token without membership', async () => {
    mockClient({ user: { id: USER_ID, email: 'owner@nibrexo.test' }, membership: null });

    const result = await resolveActorFromToken('test-token');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_ORGANIZATION');
  });
});
