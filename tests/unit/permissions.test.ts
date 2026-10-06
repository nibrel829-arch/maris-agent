import { describe, expect, it } from 'vitest';
import { actionsFor, checkPermission } from '@/server/auth/permissions';
import { actor, OTHER_ORG, TEST_ORG } from '../helpers/context';

describe('Permission guard (PDF #08 §7)', () => {
  it('grants owners full control of settings', () => {
    const decision = checkPermission(actor({ role: 'owner' }), {
      module: 'settings',
      action: 'edit',
    });
    expect(decision.allowed).toBe(true);
  });

  it('denies members from publishing to social', () => {
    const decision = checkPermission(actor({ role: 'member' }), {
      module: 'social',
      action: 'publish',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/does not have "publish"/);
  });

  it('denies members from sending email', () => {
    const decision = checkPermission(actor({ role: 'member' }), {
      module: 'email',
      action: 'send',
    });
    expect(decision.allowed).toBe(false);
  });

  it('denies cross-organization access even for owners', () => {
    const decision = checkPermission(actor({ role: 'owner' }), {
      module: 'clients',
      action: 'view',
    }, OTHER_ORG);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/Cross-organization/);
  });

  it('allows access inside the actor organization', () => {
    expect(
      checkPermission(actor(), { module: 'clients', action: 'view' }, TEST_ORG).allowed,
    ).toBe(true);
  });

  it('restricts the client role to read-only access', () => {
    const clientActions = actionsFor('client', 'clients');
    expect(clientActions).toEqual(['view']);
  });

  it('never grants the client role any settings permission', () => {
    expect(actionsFor('client', 'settings')).toEqual([]);
  });
});
