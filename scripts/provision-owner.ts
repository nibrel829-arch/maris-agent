#!/usr/bin/env node
/**
 * Nibrexo owner provisioning + authorization verification CLI.
 *
 *   npm run auth:status      -- --email=owner@nibrexo.com              # read-only report
 *   npm run auth:provision   -- --email=owner@nibrexo.com --apply      # attach as owner
 *   npm run auth:provision   -- --email=owner@nibrexo.com --print-sql  # SQL for the SQL editor
 *
 * What it does, in order (PDF #06 §5 + PDF #11 §4):
 *
 *   Supabase Auth user -> profile -> organization -> membership -> owner role
 *
 *  1. resolves the *existing* Auth user (by email or `--user-id`) — it never
 *     creates, invites or deletes an account, and it never adds a signup flow;
 *  2. reads the live state of `organizations`, `profiles` and `memberships`;
 *  3. plans the change with the same pure rules the tests cover
 *     (`src/server/auth/provisioning.ts`) — reusing the existing organization
 *     when one already exists, refusing to guess when several exist;
 *  4. with `--apply`, writes only what the plan requires, via the server-only
 *     secret key (RLS is bypassed by the service role, no policy is changed);
 *  5. re-reads and replays the exact production resolution
 *     (`resolveActorFromRecords` + the permission guard) to prove the chain.
 *
 * Secrets: the project URL, the public key and the server key are read from the
 * environment (or `.env.local` / `.env`) and are NEVER printed, logged or
 * written to disk. Emails are printed masked; UUIDs and slug names are printed
 * because they are needed to verify the result.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  describeAuthorizationChain,
  resolveActorFromRecords,
  type AuthUserRecord,
  type ElevatedRole,
  type MembershipRecord,
} from '@/server/auth/authorization';
import { checkPermission } from '@/server/auth/permissions';
import {
  isUuid,
  planOwnerProvisioning,
  type MembershipRecordForUser,
  type OrganizationRecord,
  type ProvisionOwnerPlan,
} from '@/server/auth/provisioning';
import { findUnresolvedPlaceholders, renderProvisionSql } from './lib/provision-sql';

const SQL_PATH = resolve(process.cwd(), 'supabase/scripts/provision_owner.sql');
const DEFAULT_ORG_SLUG = 'nibrexo';
const DEFAULT_ORG_NAME = 'Nibrexo';
const MAX_USER_PAGES = 25;
const USERS_PER_PAGE = 200;

interface CliOptions {
  email: string | null;
  userId: string | null;
  orgSlug: string;
  orgName: string;
  role: ElevatedRole;
  fullName: string | null;
  apply: boolean;
  printSql: boolean;
  help: boolean;
}

interface AuthUserDetails extends AuthUserRecord {
  confirmed: boolean;
}

interface LiveState {
  organizations: OrganizationRecord[];
  memberships: MembershipRecordForUser[];
  profile: { id: string; full_name: string | null } | null;
}

/* -------------------------------------------------------------------------- */
/* CLI plumbing                                                               */
/* -------------------------------------------------------------------------- */

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    email: null,
    userId: null,
    orgSlug: DEFAULT_ORG_SLUG,
    orgName: DEFAULT_ORG_NAME,
    role: 'owner',
    fullName: null,
    apply: false,
    printSql: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg === '--print-sql') options.printSql = true;
    else if (arg.startsWith('--email=')) options.email = arg.slice('--email='.length).trim();
    else if (arg.startsWith('--user-id=')) options.userId = arg.slice('--user-id='.length).trim();
    else if (arg.startsWith('--org-slug=')) options.orgSlug = arg.slice('--org-slug='.length).trim();
    else if (arg.startsWith('--org-name=')) options.orgName = arg.slice('--org-name='.length).trim();
    else if (arg.startsWith('--full-name=')) options.fullName = arg.slice('--full-name='.length).trim();
    else if (arg.startsWith('--role=')) {
      const role = arg.slice('--role='.length).trim();
      if (role === 'owner' || role === 'admin') options.role = role;
      else throw new Error(`--role must be "owner" or "admin" (got "${role}")`);
    } else if (arg.trim() !== '') {
      throw new Error(`Unknown argument "${arg}"`);
    }
  }

  return options;
}

function printUsage(problem?: string): void {
  if (problem) console.error(`\n  ✖ ${problem}\n`);
  console.log(`
Nibrexo owner provisioning — attaches an existing Supabase Auth user to the
single Nibrexo organization as owner (or admin).

Usage
  npm run auth:status    -- --email=<owner email> [--org-slug=nibrexo]
  npm run auth:provision -- --email=<owner email> --apply
  npm run auth:provision -- --email=<owner email> --print-sql

Options
  --email=<address>     Existing Supabase Auth user to attach (invite it first).
  --user-id=<uuid>      Alternative to --email: the auth.users.id directly.
  --org-slug=<slug>     Organization slug to reuse/create. Default: ${DEFAULT_ORG_SLUG}
  --org-name=<name>     Organization name, used only when creating it. Default: ${DEFAULT_ORG_NAME}
  --role=<owner|admin>  Elevated role to grant. Default: owner
  --full-name=<name>    Optional profile name (never overwrites an existing profile).
  --apply               Write the plan. Without it the command is read-only.
  --print-sql           Print the SQL-editor equivalent (no credentials needed).

Environment (never printed)
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY   (server-only)

Exit codes
  0 ok   2 usage   3 missing/invalid server credentials   4 user not found
  5 ambiguous organization   6 write failed   7 verification failed
`);
}

/**
 * Minimal .env loader: fills only variables that are not already set, and
 * never echoes a value.
 */
function loadEnvFiles(files: string[]): void {
  for (const file of files) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function maskEmail(email: string | null): string {
  if (!email) return '(no email on record)';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = (local ?? '').slice(0, 1);
  return `${head}${'*'.repeat(Math.max(2, (local ?? '').length - 1))}@${domain}`;
}

function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as {
      role?: unknown;
    };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* SQL rendering (credential-free path)                                       */
/* -------------------------------------------------------------------------- */

function renderSql(options: CliOptions): string {
  if (!existsSync(SQL_PATH)) throw new Error(`Missing ${SQL_PATH}`);
  const rendered = renderProvisionSql(readFileSync(SQL_PATH, 'utf8'), {
    email: options.email,
    userId: options.userId,
    orgName: options.orgName,
    orgSlug: options.orgSlug,
    role: options.role,
    fullName: options.fullName,
  });

  const unresolved = findUnresolvedPlaceholders(rendered);
  if (unresolved.length > 0) {
    throw new Error(`Unresolved placeholder(s) in ${SQL_PATH}: ${unresolved.join(', ')}`);
  }

  return rendered;
}

/* -------------------------------------------------------------------------- */
/* Live reads and writes                                                      */
/* -------------------------------------------------------------------------- */

async function findAuthUser(
  client: SupabaseClient,
  options: CliOptions,
): Promise<{ user: AuthUserDetails | null; error: string | null; ambiguous: boolean }> {
  if (options.userId) {
    if (!isUuid(options.userId)) {
      return { user: null, error: '--user-id must be a UUID.', ambiguous: false };
    }
    const { data, error } = await client.auth.admin.getUserById(options.userId);
    if (error) return { user: null, error: error.message, ambiguous: false };
    if (!data.user) return { user: null, error: null, ambiguous: false };
    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? null,
        confirmed: Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at),
      },
      error: null,
      ambiguous: false,
    };
  }

  const wanted = (options.email ?? '').toLowerCase();
  let matches: AuthUserDetails[] = [];

  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) return { user: null, error: error.message, ambiguous: false };

    matches = [
      ...matches,
      ...data.users
        .filter((user) => (user.email ?? '').toLowerCase() === wanted)
        .map((user) => ({
          id: user.id,
          email: user.email ?? null,
          confirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
        })),
    ];

    if (matches.length > 1) return { user: null, error: null, ambiguous: true };
    if (data.users.length < USERS_PER_PAGE) break;
  }

  return { user: matches[0] ?? null, error: null, ambiguous: false };
}

async function readState(client: SupabaseClient, userId: string): Promise<LiveState> {
  const organizations = await client
    .from('organizations')
    .select('id, name, slug')
    .order('created_at', { ascending: true });

  if (organizations.error) throw new Error(organizations.error.message);

  const membershipResult = await client
    .from('memberships')
    .select('organization_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (membershipResult.error) throw new Error(membershipResult.error.message);

  const profileResult = await client
    .from('profiles')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (profileResult.error) throw new Error(profileResult.error.message);

  return {
    organizations: (organizations.data ?? []) as OrganizationRecord[],
    memberships: (membershipResult.data ?? []) as MembershipRecordForUser[],
    profile: (profileResult.data as { id: string; full_name: string | null } | null) ?? null,
  };
}

async function countProfileRows(client: SupabaseClient, userId: string): Promise<number> {
  const { count } = await client
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('id', userId);
  return count ?? 0;
}

/**
 * Executes a plan. Every write is idempotent: the unique constraints from
 * `0001_core_identity.sql` (`organizations.slug`,
 * `memberships (organization_id, user_id)`, `profiles.id`) plus the planned
 * reads mean a second run cannot create duplicates.
 */
async function applyPlan(
  client: SupabaseClient,
  plan: ProvisionOwnerPlan,
  fullName: string | null,
): Promise<{ organizationId: string; wrote: string[] }> {
  const wrote: string[] = [];
  let organizationId = plan.organization.id;

  if (plan.organization.willBeCreated) {
    const created = await client
      .from('organizations')
      .insert({ name: plan.organization.name, slug: plan.organization.slug })
      .select('id, name, slug')
      .single();

    if (created.error) {
      // A concurrent run may have created it first: re-read instead of duplicating.
      const existing = await client
        .from('organizations')
        .select('id, name, slug')
        .eq('slug', plan.organization.slug)
        .maybeSingle();
      if (existing.error || !existing.data) throw new Error(created.error.message);
      organizationId = (existing.data as OrganizationRecord).id;
      wrote.push(`organization already present (reused ${organizationId})`);
    } else {
      organizationId = (created.data as OrganizationRecord).id;
      wrote.push(`created organization ${organizationId}`);
    }
  }

  if (!organizationId) throw new Error('Organization id could not be resolved.');

  if (plan.profileWillBeCreated) {
    // `on conflict (id) do nothing` — an existing profile is never overwritten.
    const profile = await client
      .from('profiles')
      .upsert({ id: plan.userId, full_name: fullName }, { onConflict: 'id', ignoreDuplicates: true });
    if (profile.error) throw new Error(profile.error.message);
    wrote.push('created profile row');
  }

  const membershipWrite =
    plan.membershipWillBeCreated || plan.membershipRoleChange !== null
      ? await client
          .from('memberships')
          .upsert(
            { organization_id: organizationId, user_id: plan.userId, role: plan.role },
            { onConflict: 'organization_id,user_id' },
          )
      : null;

  if (membershipWrite?.error) throw new Error(membershipWrite.error.message);
  if (membershipWrite) {
    wrote.push(
      plan.membershipWillBeCreated
        ? `created memberships row (${plan.role})`
        : `promoted membership to ${plan.role}`,
    );
  }

  return { organizationId, wrote };
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                  */
/* -------------------------------------------------------------------------- */

function printState(label: string, state: LiveState, user: AuthUserDetails): void {
  console.log(`\n${label}`);
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  auth user            : ${user.id}`);
  console.log(`  email                : ${maskEmail(user.email)} (confirmed: ${user.confirmed ? 'yes' : 'no'})`);
  console.log(`  organizations (${state.organizations.length})       : ${
    state.organizations.length === 0
      ? '(none yet)'
      : state.organizations.map((organization) => `${organization.slug} [${organization.id}]`).join(', ')
  }`);
  console.log(`  profile row          : ${state.profile ? 'present' : 'MISSING'}`);
  console.log(
    `  memberships (${state.memberships.length})       : ${
      state.memberships.length === 0
        ? 'NONE — this is why the app reports "not a member of any organization"'
        : state.memberships.map((membership) => `${membership.organization_id} → ${membership.role}`).join(', ')
    }`,
  );
}

function printPlan(plan: ProvisionOwnerPlan): void {
  console.log('\nPlanned authorization change');
  console.log('────────────────────────────────────────────────────────────');
  for (const step of plan.steps) {
    switch (step.kind) {
      case 'create_organization':
        console.log(`  * create organization "${step.slug}" ("${step.name}")`);
        break;
      case 'reuse_organization':
        console.log(`  · reuse existing organization "${step.slug}" [${step.organizationId}]`);
        break;
      case 'create_profile':
        console.log('  * create profile row');
        break;
      case 'keep_profile':
        console.log('  · keep existing profile row');
        break;
      case 'create_membership':
        console.log(`  * create membership with role "${step.role}"`);
        break;
      case 'promote_membership':
        console.log(`  * change membership role "${step.from}" → "${step.to}"`);
        break;
      case 'keep_membership':
        console.log(`  · keep membership role "${step.role}"`);
        break;
    }
  }
  for (const note of plan.notes) console.log(`  note: ${note}`);
  console.log(
    plan.alreadyAuthorized
      ? '  result: already authorized — no write required.'
      : '  result: changes required.',
  );
}

function printChain(input: {
  user: AuthUserDetails;
  state: LiveState;
  actorRole: string | null;
  organizationId: string | null;
  dashboardAllowed: boolean | null;
  settingsAllowed: boolean | null;
}): void {
  const chain = describeAuthorizationChain({
    user: input.user,
    membership: input.state.memberships[0] ?? null,
    profile: input.state.profile,
    organization: input.state.organizations[0] ?? null,
  });

  console.log('\nAuthorization chain (verified against the live database)');
  console.log('────────────────────────────────────────────────────────────');
  const mark = (value: boolean): string => (value ? 'ok  ' : 'FAIL');
  console.log(`  ${mark(chain.authenticated)} 1. Supabase Auth session (${input.user.id})`);
  console.log(`  ${mark(chain.hasProfile)} 2. profile resolution — public.profiles`);
  console.log(
    `  ${mark(chain.organizationName !== null)} 3. organization resolution — ${chain.organizationSlug ?? '(none)'} [${input.organizationId ?? '-'}]`,
  );
  console.log(
    `  ${mark(chain.hasMembership)} 4. membership resolution — ${input.actorRole ?? '(none)'}`,
  );
  console.log(
    `  ${mark(chain.elevated)} 5. owner/admin role — ${input.actorRole ?? '(none)'}`,
  );
  console.log(
    `  ${mark(input.dashboardAllowed === true)} 6. permission guard — dashboard.view`,
  );
  console.log(
    `  ${mark(input.settingsAllowed === true)} 7. permission guard — settings.edit (elevated)`,
  );
  console.log(
    `  ${mark(chain.elevated && input.dashboardAllowed === true)} 8. Nibrexo Manager / dashboard access`,
  );
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    printUsage(error instanceof Error ? error.message : 'Invalid arguments');
    return 2;
  }

  if (options.help) {
    printUsage();
    return 0;
  }

  if (!options.email && !options.userId) {
    printUsage('Provide the signed-in user with --email=<address> (or --user-id=<uuid>).');
    return 2;
  }

  if (options.printSql) {
    process.stdout.write(renderSql(options));
    return 0;
  }

  loadEnvFiles(['.env.local', '.env']);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secretKeyName = process.env.SUPABASE_SECRET_KEY
    ? 'SUPABASE_SECRET_KEY'
    : process.env.SUPABASE_SERVICE_ROLE_KEY
      ? 'SUPABASE_SERVICE_ROLE_KEY'
      : null;
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !secretKey || !secretKeyName) {
    console.error(
      '\n  ✖ Missing Supabase server credentials. Set NEXT_PUBLIC_SUPABASE_URL and one of SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY (server-only) in the environment or .env.local.\n    Use --print-sql to get a SQL-editor version that needs no credentials.',
    );
    return 3;
  }

  if (publicKey && secretKey === publicKey) {
    console.error('\n  ✖ The configured server key is the public anon/publishable key. Use the server-only secret key.\n');
    return 3;
  }

  const role = jwtRole(secretKey);
  if (role === 'anon' || role === 'authenticated') {
    console.error(`\n  ✖ The configured server key carries the "${role}" role; a service-role/secret key is required.\n`);
    return 3;
  }

  let projectHost = '(unparsable URL)';
  try {
    projectHost = new URL(url).host;
  } catch {
    /* reported below as unparsable */
  }

  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  console.log('\nNibrexo authorization provisioning');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`  project              : ${projectHost}`);
  console.log(`  server key source    : ${secretKeyName} (present, never printed)`);
  console.log(`  mode                 : ${options.apply ? 'APPLY (writes)' : 'read-only diagnosis'}`);
  console.log(`  target organization  : ${options.orgSlug} / "${options.orgName}"`);

  const found = await findAuthUser(client, options);
  if (found.ambiguous) {
    console.error('\n  ✖ Several auth users share that email. Pass --user-id=<uuid> instead.\n');
    return 4;
  }
  if (found.error) {
    console.error(`\n  ✖ Could not resolve the auth user: ${found.error}\n`);
    return 4;
  }
  if (!found.user) {
    console.error(
      '\n  ✖ No Supabase Auth user matches. Invite/create that user in Authentication → Users first: this tool never creates accounts and never adds a signup flow.\n',
    );
    return 4;
  }

  const user = found.user;
  let state: LiveState;
  try {
    state = await readState(client, user.id);
  } catch (error) {
    console.error(
      `\n  ✖ Could not read the database: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    console.error('    Check that migrations 0001-0008 are applied to this project.\n');
    return 6;
  }

  printState('Current state', state, user);

  const planned = planOwnerProvisioning(
    {
      userId: user.id,
      organizationName: options.orgName,
      organizationSlug: options.orgSlug,
      role: options.role,
      fullName: options.fullName,
    },
    {
      profile: state.profile,
      organizations: state.organizations,
      memberships: state.memberships,
    },
  );

  if (!planned.ok) {
    console.error(`\n  ✖ ${planned.error.code}: ${planned.error.message}\n`);
    return planned.error.code === 'AMBIGUOUS_ORGANIZATION' ? 5 : 2;
  }

  const plan = planned.data;
  printPlan(plan);

  if (!options.apply) {
    printChain({
      user,
      state,
      actorRole: state.memberships[0]?.role ?? null,
      organizationId: state.organizations[0]?.id ?? null,
      dashboardAllowed: null,
      settingsAllowed: null,
    });
    console.log(
      plan.alreadyAuthorized
        ? '\nNo changes needed. Sign in at /login — the workspace will resolve your organization and role.\n'
        : '\nRead-only run: nothing was written. Re-run with --apply to perform the plan above.\n',
    );
    return 0;
  }

  let resolvedOrganizationId = plan.organization.id;

  if (!plan.requiresWrite) {
    console.log('\nNothing to write: the authorization chain already matches the intended state.\n');
  } else {
    try {
      const applied = await applyPlan(client, plan, options.fullName);
      resolvedOrganizationId = applied.organizationId;
      console.log('\nApplied');
      console.log('────────────────────────────────────────────────────────────');
      for (const entry of applied.wrote) console.log(`  ✓ ${entry}`);
    } catch (error) {
      console.error(
        `\n  ✖ Write failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
      );
      return 6;
    }
  }

  // Re-read and replay the production resolution on the fresh rows.
  let after: LiveState;
  try {
    after = await readState(client, user.id);
  } catch (error) {
    console.error(
      `\n  ✖ Verification read failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    return 7;
  }

  const verifyPlan = planOwnerProvisioning(
    {
      userId: user.id,
      organizationName: options.orgName,
      organizationSlug: options.orgSlug,
      role: options.role,
      fullName: options.fullName,
    },
    { profile: after.profile, organizations: after.organizations, memberships: after.memberships },
  );

  const targetOrganization =
    after.organizations.find((organization) => organization.id === resolvedOrganizationId) ??
    after.organizations[0] ??
    null;

  const membershipRecord: MembershipRecord | null = targetOrganization
    ? (after.memberships.find(
        (membership) => membership.organization_id === targetOrganization.id,
      ) ?? null)
    : null;

  const actorResult = resolveActorFromRecords({
    user: { id: user.id, email: user.email },
    membership: membershipRecord,
    profile: after.profile,
    isDevIdentity: false,
  });

  // The same permission guard the server uses before executing any tool.
  const dashboardAllowed = actorResult.ok
    ? checkPermission(actorResult.data, { module: 'dashboard', action: 'view' }).allowed
    : false;
  const settingsAllowed = actorResult.ok
    ? checkPermission(actorResult.data, { module: 'settings', action: 'edit' }).allowed
    : false;

  printChain({
    user,
    state: after,
    actorRole: actorResult.ok ? actorResult.data.role : null,
    organizationId: actorResult.ok ? actorResult.data.organizationId : null,
    dashboardAllowed,
    settingsAllowed,
  });

  const profileRows = await countProfileRows(client, user.id);
  const targetMemberships = targetOrganization
    ? after.memberships.filter(
        (membership) => membership.organization_id === targetOrganization.id,
      ).length
    : 0;

  console.log('\nDuplicate / boundary checks');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`  organizations in project : ${after.organizations.length} (created: ${plan.organization.willBeCreated ? 'yes' : 'no'})`);
  console.log(`  profile rows for user    : ${profileRows}`);
  console.log(`  memberships in target org: ${targetMemberships}`);
  console.log('  RLS policies             : unchanged (0004 / 0005)');
  console.log('  auth architecture        : unchanged (no signup flow, no policy edit)');

  const ok =
    verifyPlan.ok &&
    verifyPlan.data.alreadyAuthorized &&
    actorResult.ok &&
    (actorResult.data.role === 'owner' || actorResult.data.role === 'admin') &&
    dashboardAllowed &&
    settingsAllowed &&
    profileRows === 1 &&
    targetMemberships === 1;

  if (!ok) {
    console.error(
      '\n  ✖ Verification failed: the live rows do not resolve to an owner/admin actor with dashboard access.\n',
    );
    return 7;
  }

  console.log(
    `\n  ✓ ${maskEmail(user.email)} resolves to ${actorResult.ok ? actorResult.data.role : '?'} of "${targetOrganization?.slug ?? options.orgSlug}".`,
  );
  console.log('    Sign in at /login — /manager and /dashboard now authorize.\n');
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`\n  ✖ ${error instanceof Error ? error.message : 'Unexpected error'}\n`);
    process.exitCode = 7;
  });
