import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MembershipRecordForUser, OrganizationRecord } from '@/server/auth/provisioning';
import {
  ORGANIZATION_SLUG_PATTERN,
  isUuid,
  planOwnerProvisioning,
  type ProvisionOwnerPlan,
  type ProvisionOwnerSnapshot,
} from '@/server/auth/provisioning';
import type { ElevatedRole } from '@/server/auth/authorization';
import {
  findUnresolvedPlaceholders,
  renderProvisionSql,
  sqlLiteral,
} from '../../scripts/lib/provision-sql';
import { TEST_ORG } from '../helpers/context';

const USER_ID = '00000000-0000-0000-0000-0000000000f1';
const CREATED_ORG = '00000000-0000-0000-0000-0000000000c0';

const request = {
  userId: USER_ID,
  organizationName: 'Nibrexo',
  organizationSlug: 'nibrexo',
} as const;

const empty: ProvisionOwnerSnapshot = { profile: null, organizations: [], memberships: [] };

const existingOrganization: OrganizationRecord = { id: TEST_ORG, name: 'Nibrexo', slug: 'nibrexo' };

function otherOrganization(index: number): OrganizationRecord {
  return {
    id: `00000000-0000-0000-0000-0000000001${String(index).padStart(2, '0')}`,
    name: `Other ${index}`,
    slug: `other-${index}`,
  };
}

/**
 * Applies a plan to a snapshot the same way the CLI writes it, so idempotency
 * can be proven without a database.
 */
function simulate(
  plan: ProvisionOwnerPlan,
  snapshot: ProvisionOwnerSnapshot,
  createdOrgId = CREATED_ORG,
): ProvisionOwnerSnapshot {
  const organizations = [...snapshot.organizations];
  const memberships = [...snapshot.memberships];
  let profile = snapshot.profile;
  let targetId = plan.organization.id;

  for (const step of plan.steps) {
    switch (step.kind) {
      case 'create_organization':
        targetId = createdOrgId;
        organizations.push({ id: createdOrgId, name: step.name, slug: step.slug });
        break;
      case 'create_profile':
        profile = { id: step.userId };
        break;
      case 'create_membership':
        memberships.push({ organization_id: targetId ?? '', role: step.role });
        break;
      case 'promote_membership': {
        const index = memberships.findIndex(
          (membership) => membership.organization_id === step.organizationId,
        );
        if (index >= 0) {
          memberships[index] = { organization_id: step.organizationId, role: step.to };
        }
        break;
      }
      default:
        break;
    }
  }

  return { profile, organizations, memberships };
}

describe('Owner provisioning plan (existing schema, no duplicates)', () => {
  it('creates the single Nibrexo organization, a profile and an owner membership when the project is empty', () => {
    const result = planOwnerProvisioning(request, empty);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const kinds = result.data.steps.map((step) => step.kind);
    expect(kinds).toEqual(['create_organization', 'create_profile', 'create_membership']);
    expect(result.data.organization.willBeCreated).toBe(true);
    expect(result.data.profileWillBeCreated).toBe(true);
    expect(result.data.membershipWillBeCreated).toBe(true);
    expect(result.data.requiresWrite).toBe(true);
    expect(result.data.alreadyAuthorized).toBe(false);
    expect(result.data.notes.join(' ')).toMatch(/No organization exists/);
  });

  it('reuses the existing organization instead of creating a second one', () => {
    const result = planOwnerProvisioning(request, {
      profile: { id: USER_ID },
      organizations: [existingOrganization],
      memberships: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const kinds = result.data.steps.map((step) => step.kind);
    expect(kinds).toEqual(['reuse_organization', 'keep_profile', 'create_membership']);
    expect(result.data.organization).toMatchObject({ id: TEST_ORG, willBeCreated: false });
    expect(result.data.profileWillBeCreated).toBe(false);
    expect(kinds).not.toContain('create_organization');
  });

  it('reuses the single existing organization even when its slug differs (never a duplicate)', () => {
    const result = planOwnerProvisioning(request, {
      profile: null,
      organizations: [{ id: TEST_ORG, name: 'Nibrexo Inc', slug: 'nibrexo-inc' }],
      memberships: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.organization.id).toBe(TEST_ORG);
    expect(result.data.organization.willBeCreated).toBe(false);
  });

  it('refuses to guess when several organizations exist and none matches the slug', () => {
    const result = planOwnerProvisioning(request, {
      profile: null,
      organizations: [otherOrganization(1), otherOrganization(2)],
      memberships: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('AMBIGUOUS_ORGANIZATION');
    expect(result.error.message).toMatch(/Refusing to guess/);
  });

  it('selects the matching organization when several exist', () => {
    const result = planOwnerProvisioning(request, {
      profile: null,
      organizations: [otherOrganization(1), existingOrganization],
      memberships: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.organization.id).toBe(TEST_ORG);
    expect(result.data.organization.willBeCreated).toBe(false);
  });

  it('promotes an existing lower-privilege membership to owner', () => {
    const result = planOwnerProvisioning(request, {
      profile: { id: USER_ID },
      organizations: [existingOrganization],
      memberships: [{ organization_id: TEST_ORG, role: 'member' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.membershipRoleChange).toEqual({ from: 'member', to: 'owner' });
    expect(result.data.steps.map((step) => step.kind)).toContain('promote_membership');
    expect(result.data.membershipWillBeCreated).toBe(false);
  });

  it('never downgrades an existing owner when a lower role is requested', () => {
    const result = planOwnerProvisioning(
      { ...request, role: 'admin' },
      {
        profile: { id: USER_ID },
        organizations: [existingOrganization],
        memberships: [{ organization_id: TEST_ORG, role: 'owner' }],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.membershipRoleChange).toBeNull();
    expect(result.data.steps.map((step) => step.kind)).toContain('keep_membership');
    expect(result.data.alreadyAuthorized).toBe(true);
    expect(result.data.notes.join(' ')).toMatch(/no downgrade|ignored/i);
  });

  it('attaches to the matching organization and leaves other memberships untouched', () => {
    const other = otherOrganization(1);
    const memberships: MembershipRecordForUser[] = [{ organization_id: other.id, role: 'owner' }];
    const result = planOwnerProvisioning(request, {
      profile: { id: USER_ID },
      organizations: [other, existingOrganization],
      memberships,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.organization.id).toBe(TEST_ORG);
    // A membership elsewhere does not satisfy this organization.
    expect(result.data.steps.map((step) => step.kind)).toContain('create_membership');
    expect(result.data.notes.join(' ')).toMatch(/other organizations/);
  });

  it('reports already authorized when the owner membership is in place', () => {
    const result = planOwnerProvisioning(request, {
      profile: { id: USER_ID },
      organizations: [existingOrganization],
      memberships: [{ organization_id: TEST_ORG, role: 'owner' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alreadyAuthorized).toBe(true);
    expect(result.data.requiresWrite).toBe(false);
  });

  it('is idempotent: re-planning after applying the plan changes nothing', () => {
    const first = planOwnerProvisioning(request, empty);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const after = simulate(first.data, empty);
    const second = planOwnerProvisioning(request, after);

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.alreadyAuthorized).toBe(true);
    expect(second.data.requiresWrite).toBe(false);
    expect(second.data.steps.some((step) => step.kind.startsWith('create_'))).toBe(false);
    expect(after.organizations).toHaveLength(1);
    expect(after.memberships).toHaveLength(1);
  });

  it('is idempotent for an existing lower-privilege membership', () => {
    const snapshot: ProvisionOwnerSnapshot = {
      profile: { id: USER_ID },
      organizations: [existingOrganization],
      memberships: [{ organization_id: TEST_ORG, role: 'admin' }],
    };
    const first = planOwnerProvisioning(request, snapshot);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const after = simulate(first.data, snapshot);
    const second = planOwnerProvisioning(request, after);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.alreadyAuthorized).toBe(true);
    expect(after.memberships).toEqual([{ organization_id: TEST_ORG, role: 'owner' }]);
  });

  it('validates input before touching the database', () => {
    const badUser = planOwnerProvisioning({ ...request, userId: 'not-a-uuid' }, empty);
    expect(badUser.ok).toBe(false);
    if (!badUser.ok) expect(badUser.error.code).toBe('INVALID_USER_ID');

    const badSlug = planOwnerProvisioning({ ...request, organizationSlug: 'Nibrexo!' }, empty);
    expect(badSlug.ok).toBe(false);
    if (!badSlug.ok) expect(badSlug.error.code).toBe('INVALID_ORG_SLUG');

    const badName = planOwnerProvisioning({ ...request, organizationName: '   ' }, empty);
    expect(badName.ok).toBe(false);
    if (!badName.ok) expect(badName.error.code).toBe('INVALID_ORG_NAME');

    const badRole = planOwnerProvisioning(
      { ...request, role: 'client' as unknown as ElevatedRole },
      empty,
    );
    expect(badRole.ok).toBe(false);
    if (!badRole.ok) expect(badRole.error.code).toBe('INVALID_ROLE');
  });

  it('mirrors the organizations.slug constraint from 0001_core_identity.sql', () => {
    expect(ORGANIZATION_SLUG_PATTERN.test('nibrexo')).toBe(true);
    expect(ORGANIZATION_SLUG_PATTERN.test('nibrexo-os')).toBe(true);
    expect(ORGANIZATION_SLUG_PATTERN.test('a')).toBe(false);
    expect(ORGANIZATION_SLUG_PATTERN.test('Nibrexo')).toBe(false);
    expect(ORGANIZATION_SLUG_PATTERN.test('-nibrexo')).toBe(false);
    expect(isUuid(USER_ID)).toBe(true);
    expect(isUuid('00000000-0000-0000-0000-00000000000')).toBe(false);
  });
});

describe('SQL bootstrap artifact (supabase/scripts/provision_owner.sql)', () => {
  const root = resolve(process.cwd());
  const sqlPath = resolve(root, 'supabase/scripts/provision_owner.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  it('is an operator script, never an auto-applied migration', () => {
    const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter((name) =>
      name.endsWith('.sql'),
    );
    expect(migrations).toEqual([
      '0001_core_identity.sql',
      '0002_modules.sql',
      '0003_manager_agent.sql',
      '0004_rls_policies.sql',
      '0005_rls_hardening.sql',
    ]);
    expect(migrations.some((name) => name.includes('provision'))).toBe(false);
  });

  it('never creates an auth user (no signup flow)', () => {
    expect(sql).not.toMatch(/insert\s+into\s+auth\.users/i);
    expect(sql).not.toMatch(/createUser/);
    expect(sql).not.toMatch(/\.signUp\(/);
    expect(sql).not.toMatch(/delete\s+from/i);
    expect(sql).toMatch(/auth\.users/);
  });

  it('is administrator-only and idempotent', () => {
    expect(sql).toContain("current_user not in ('postgres', 'supabase_admin', 'dashboard_user', 'service_role')");
    expect(sql).toContain('on conflict (id) do nothing');
    expect(sql).toContain('where m.organization_id = v_org_id and m.user_id = v_user_id');
    expect(sql).toContain('Refusing to guess');
    expect(sql.match(/raise exception/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('verifies the same chain the application resolves', () => {
    expect(sql).toContain('auth_user_id');
    expect(sql).toContain('left join public.profiles p on p.id = u.id');
    expect(sql).toContain('left join public.memberships m on m.user_id = u.id');
    expect(sql).toContain('left join public.organizations o on o.id = m.organization_id');
  });

  it('renders every placeholder for the SQL editor', () => {
    const rendered = renderProvisionSql(sql, {
      email: "owner's-team@nibrexo.com",
      userId: null,
      orgName: 'Nibrexo',
      orgSlug: 'nibrexo',
      role: 'owner',
      fullName: null,
    });

    expect(findUnresolvedPlaceholders(rendered)).toEqual([]);
    expect(rendered).toContain(`v_owner_email text := ${sqlLiteral("owner's-team@nibrexo.com")}`);
    expect(rendered).toContain(`where lower(u.email) = lower(${sqlLiteral("owner's-team@nibrexo.com")})`);
    expect(rendered).toContain("v_org_slug    text := 'nibrexo';");
  });

  it('renders the id-based verification when a user id is supplied', () => {
    const rendered = renderProvisionSql(sql, {
      email: null,
      userId: USER_ID,
      orgName: 'Nibrexo',
      orgSlug: 'nibrexo',
      role: 'owner',
      fullName: null,
    });

    expect(rendered).toContain(`v_owner_id    uuid := '${USER_ID}';`);
    expect(rendered).toContain(`where u.id = '${USER_ID}'`);
    expect(findUnresolvedPlaceholders(rendered)).toEqual([]);
  });
});
