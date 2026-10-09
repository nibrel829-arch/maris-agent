import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
      '0006_clients_crm.sql',
      '0007_content_storage.sql',
      '0008_social_connections.sql',
      '0009_publish_jobs.sql',
      '0010_unified_inbox.sql',
      '0011_email_templates_sending.sql',
      '0012_email_sequences_execution.sql',
      '0013_generated_media.sql',
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

/**
 * Strips `--` line comments so structural assertions cannot be satisfied — or
 * broken — by prose in the file header.
 */
function withoutComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('Schema drift: diagnose_schema.sql and the bootstrap preflight', () => {
  const root = resolve(process.cwd());
  const bootstrapRaw = readFileSync(resolve(root, 'supabase/scripts/provision_owner.sql'), 'utf8');
  const diagnoseRaw = readFileSync(resolve(root, 'supabase/scripts/diagnose_schema.sql'), 'utf8');
  const bootstrap = withoutComments(bootstrapRaw);
  const diagnose = withoutComments(diagnoseRaw);

  it('keeps public.org_role authoritative: declared by the bootstrap, never created by it', () => {
    // Regression guard for `ERROR 42704: type "public.org_role" does not exist`:
    // the fix is to apply migration 0001, never to bypass or recreate the enum.
    expect(bootstrap).toContain('public.org_role');
    expect(bootstrap).toContain("public.org_role := 'owner'");
    expect(bootstrap).not.toMatch(/create\s+type/i);
    expect(bootstrap).not.toMatch(/create\s+table/i);
    expect(bootstrap).not.toMatch(/create\s+extension/i);
    expect(bootstrap).not.toMatch(/\balter\s+table\b/i);
    expect(bootstrap).not.toMatch(/\bdrop\s+/i);
    expect(bootstrap).not.toMatch(/\bdelete\s+from\b/i);
    expect(bootstrap).not.toMatch(/\btruncate\b/i);
  });

  it('stops with an actionable preflight message when the migrations are not applied', () => {
    expect(bootstrap).toContain("to_regtype('public.org_role')");
    expect(bootstrap).toContain("to_regclass('public.organizations')");
    expect(bootstrap).toContain("to_regclass('public.profiles')");
    expect(bootstrap).toContain("to_regclass('public.memberships')");
    expect(bootstrap).toContain('is not fully applied to this project');
    expect(bootstrap).toContain('supabase/migrations/0001_core_identity.sql');
    expect(bootstrap).toContain('Nothing was created or modified by this run.');

    // The preflight must execute before anything can be written.
    const preflight = bootstrapRaw.indexOf('PREFLIGHT');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(bootstrapRaw.indexOf("v_owner_email text :="));
    expect(bootstrapRaw.indexOf("to_regtype('public.org_role')")).toBeLessThan(
      bootstrapRaw.indexOf("v_owner_email text :="),
    );
  });

  it('renders the preflight into the SQL-editor output too', () => {
    const rendered = renderProvisionSql(bootstrapRaw, {
      email: 'owner@nibrexo.com',
      userId: null,
      orgName: 'Nibrexo',
      orgSlug: 'nibrexo',
      role: 'owner',
      fullName: null,
    });
    expect(rendered).toContain('is not fully applied to this project');
    expect(rendered).toContain("v_role        public.org_role := 'owner';");
    expect(findUnresolvedPlaceholders(rendered)).toEqual([]);
  });

  it('ships a read-only diagnostic that creates, alters and deletes nothing', () => {
    expect(diagnose).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
    expect(diagnose).not.toMatch(
      /create\s+(table|type|extension|index|policy|trigger|function|temp|temporary|or\s+replace)/i,
    );
    // It must not read the tenant tables either: it has to work when they are missing.
    expect(diagnose).not.toMatch(/\bfrom\s+public\.(organizations|profiles|memberships)\b/i);
  });

  it('checks every object the bootstrap and the actor resolution depend on', () => {
    for (const object of [
      'public.org_role',
      'public.organizations',
      'public.profiles',
      'public.memberships',
      'public.is_org_member(uuid)',
      'public.org_role_of(uuid)',
      'public.is_org_admin(uuid)',
      'public.clients',
      'public.ai_tasks',
      'public.approvals',
    ]) {
      expect(diagnose).toContain(object);
    }
    // RLS state and the same-named-type edge case from the 0001 guards.
    expect(diagnose).toContain('relrowsecurity');
    expect(diagnose).toContain('pg_policies');
    expect(diagnose).toContain('typname');
  });

  it('reads the Supabase CLI migration bookkeeping defensively', () => {
    expect(diagnose).toContain('supabase_migrations.schema_migrations');
    expect(diagnose).toContain('raise notice');
    expect(diagnose).toContain('Do NOT create public.org_role');
  });
});

describe('SQL-Editor bundle: the paste must be pure SQL', () => {
  const root = resolve(process.cwd());
  const emitter = readFileSync(resolve(root, 'scripts/emit-migrations.mjs'), 'utf8');

  it('generates the bundle from the migration files, never from a copy', async () => {
    const { loadMigrations, renderMigrations } = await import('../../scripts/lib/migrations-sql.mjs');
    const migrations = loadMigrations(root);

    expect(migrations.map((migration) => migration.name)).toEqual([
      '0001_core_identity.sql',
      '0002_modules.sql',
      '0003_manager_agent.sql',
      '0004_rls_policies.sql',
      '0005_rls_hardening.sql',
      '0006_clients_crm.sql',
      '0007_content_storage.sql',
      '0008_social_connections.sql',
      '0009_publish_jobs.sql',
      '0010_unified_inbox.sql',
      '0011_email_templates_sending.sql',
      '0012_email_sequences_execution.sql',
      '0013_generated_media.sql',
    ]);

    const bundle = renderMigrations(migrations);
    // Every migration appears verbatim, in order — no rewriting, no simplification.
    let cursor = 0;
    for (const migration of migrations) {
      const at = bundle.indexOf(migration.sql.trim(), cursor);
      expect(at, `${migration.name} must appear verbatim and in order`).toBeGreaterThan(-1);
      cursor = at + migration.sql.trim().length;
    }
    // Provisioning is a separate file: the schema bundle must contain no
    // bootstrap logic and must never insert rows (the only mention of
    // provision_owner.sql is the header comment telling the operator to run it
    // afterwards).
    expect(bundle).not.toContain('v_owner_email');
    expect(bundle).not.toMatch(/insert\s+into\s+public\.(organizations|profiles|memberships)/i);
    expect(bundle.match(/provision_owner/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('refuses to emit a bundle contaminated by the npm script banner', () => {
    // Regression guard: `npm run db:sql > file.sql` used to prepend
    // "> nibrexo-os-ai@0.1.0 db:sql" to the file, which the SQL Editor rejects.
    expect(emitter).toContain("assertPureSql");
    expect(emitter).toContain("line.startsWith('>')");
    expect(emitter).toContain("first.startsWith('--')");
    // Default is a file written by node, so npm's stdout banner cannot leak in.
    expect(emitter).toContain("process.argv.slice(2)");
    expect(emitter).toContain("const DEFAULT_OUT = resolve(root, 'all_migrations.sql')");
  });

  it('keeps the generated all_migrations.sql (when present) free of non-SQL lines', () => {
    const bundlePath = resolve(root, 'all_migrations.sql');
    if (!existsSync(bundlePath)) return; // generated on demand; git-ignored
    const bundle = readFileSync(bundlePath, 'utf8');
    expect(bundle.startsWith('--')).toBe(true);
    expect(bundle.split('\n').filter((line) => line.startsWith('>'))).toEqual([]);
    expect(bundle).not.toMatch(/drop\s+(table|column|type|schema|database)\b/i);
    expect(bundle).not.toMatch(/\b(truncate|delete\s+from)\b/i);
    for (const name of [
      '0001_core_identity.sql',
      '0008_social_connections.sql',
      '0009_publish_jobs.sql',
      '0010_unified_inbox.sql',
    ]) {
      expect(bundle).toContain(`-- ${name}`);
    }
  });
});
