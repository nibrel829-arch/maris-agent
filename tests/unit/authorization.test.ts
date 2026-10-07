import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_LOOKUP_FAILED_MESSAGE,
  NO_ORGANIZATION_MESSAGE,
  describeAuthorizationChain,
  isElevatedRole,
  resolveActorFromRecords,
} from '@/server/auth/authorization';
import { checkPermission } from '@/server/auth/permissions';
import { TEST_ORG } from '../helpers/context';

const USER = { id: '00000000-0000-0000-0000-0000000000f1', email: 'owner@nibrexo.test' };

describe('Authorization resolution (login -> membership -> role)', () => {
  it('reports NO_ORGANIZATION for an authenticated user without a membership row', () => {
    const result = resolveActorFromRecords({ user: USER, membership: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NO_ORGANIZATION');
    expect(result.error.message).toBe(NO_ORGANIZATION_MESSAGE);
    expect(result.error.errorClass).toBe('permission');
    expect(result.error.severity).toBe('warning');
    expect(result.error.retryable).toBe(false);
    expect(NO_ORGANIZATION_MESSAGE).toBe(
      'Your account is not a member of any organization. Ask an owner or admin to invite you.',
    );
  });

  it('resolves the owner actor once the membership row exists', () => {
    const result = resolveActorFromRecords({
      user: USER,
      membership: { organization_id: TEST_ORG, role: 'owner' },
      profile: { full_name: 'Nibrexo Owner' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      userId: USER.id,
      organizationId: TEST_ORG,
      role: 'owner',
      email: USER.email,
      fullName: 'Nibrexo Owner',
      isDevIdentity: false,
    });
  });

  it('never trusts an unknown role value from the database', () => {
    const result = resolveActorFromRecords({
      user: USER,
      membership: { organization_id: TEST_ORG, role: 'superuser' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.role).toBe('member');
  });

  it('keeps a missing profile non-fatal (fullName stays empty)', () => {
    const result = resolveActorFromRecords({
      user: USER,
      membership: { organization_id: TEST_ORG, role: 'admin' },
      profile: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.fullName).toBeNull();
    expect(result.data.role).toBe('admin');
  });
});

describe('Authorization chain reporting', () => {
  it('describes the production symptom honestly (authenticated but not attached)', () => {
    const chain = describeAuthorizationChain({
      user: USER,
      membership: null,
      profile: null,
      organization: null,
    });

    expect(chain.authenticated).toBe(true);
    expect(chain.hasProfile).toBe(false);
    expect(chain.hasMembership).toBe(false);
    expect(chain.elevated).toBe(false);
    expect(chain.role).toBeNull();
  });

  it('describes a fully attached owner', () => {
    const chain = describeAuthorizationChain({
      user: USER,
      membership: { organization_id: TEST_ORG, role: 'owner' },
      profile: { full_name: 'Nibrexo Owner' },
      organization: { name: 'Nibrexo', slug: 'nibrexo' },
    });

    expect(chain).toMatchObject({
      authenticated: true,
      hasProfile: true,
      organizationSlug: 'nibrexo',
      hasMembership: true,
      role: 'owner',
      elevated: true,
    });
  });

  it('treats member and client roles as non-elevated', () => {
    const member = describeAuthorizationChain({
      user: USER,
      membership: { organization_id: TEST_ORG, role: 'member' },
      profile: null,
      organization: { name: 'Nibrexo', slug: 'nibrexo' },
    });
    expect(member.elevated).toBe(false);

    expect(isElevatedRole('owner')).toBe(true);
    expect(isElevatedRole('admin')).toBe(true);
    expect(isElevatedRole('member')).toBe(false);
    expect(isElevatedRole('client')).toBe(false);
    expect(isElevatedRole(null)).toBe(false);
  });

  it('exposes the distinct database-read failure state', () => {
    // Guards the diagnosability fix: an unapplied migration or RLS read error
    // must not be reported as "not a member of any organization".
    expect(MEMBERSHIP_LOOKUP_FAILED_MESSAGE).not.toBe(NO_ORGANIZATION_MESSAGE);
    expect(MEMBERSHIP_LOOKUP_FAILED_MESSAGE).toMatch(/migrations/);
  });
});

describe('Provisioned owner reaches the workspace modules', () => {
  const owner = resolveActorFromRecords({
    user: USER,
    membership: { organization_id: TEST_ORG, role: 'owner' },
    profile: null,
  });

  it('passes the same guards the workspace pages enforce', () => {
    expect(owner.ok).toBe(true);
    if (!owner.ok) return;

    // /dashboard, /manager (task execution) and the module pages.
    expect(checkPermission(owner.data, { module: 'dashboard', action: 'view' }).allowed).toBe(true);
    expect(checkPermission(owner.data, { module: 'clients', action: 'view' }).allowed).toBe(true);
    expect(checkPermission(owner.data, { module: 'clients', action: 'create' }).allowed).toBe(true);
    expect(checkPermission(owner.data, { module: 'email', action: 'send' }).allowed).toBe(true);
    expect(checkPermission(owner.data, { module: 'settings', action: 'edit' }).allowed).toBe(true);
    // Cross-organization access stays denied.
    expect(
      checkPermission(owner.data, { module: 'clients', action: 'view' }, '00000000-0000-0000-0000-0000000000ff')
        .allowed,
    ).toBe(false);
  });

  it('does not over-grant: a member is still denied elevated actions', () => {
    const member = resolveActorFromRecords({
      user: USER,
      membership: { organization_id: TEST_ORG, role: 'member' },
      profile: null,
    });
    expect(member.ok).toBe(true);
    if (!member.ok) return;

    expect(checkPermission(member.data, { module: 'dashboard', action: 'view' }).allowed).toBe(true);
    expect(checkPermission(member.data, { module: 'email', action: 'send' }).allowed).toBe(false);
    expect(checkPermission(member.data, { module: 'settings', action: 'edit' }).allowed).toBe(false);
  });
});
