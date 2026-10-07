#!/usr/bin/env node
/**
 * Database-level verification of the Nibrexo schema + owner bootstrap.
 *
 * Runs the real migrations (0001-0005) and the real
 * `supabase/scripts/provision_owner.sql` against an embedded PostgreSQL
 * (@electric-sql/pglite, PostgreSQL compiled to WASM) with a minimal
 * Supabase-compatible `auth` shim. It proves, without touching the live
 * project:
 *
 *   1. all five migrations apply in order to an empty database;
 *   2. an authenticated user with no membership cannot read the organization
 *      and cannot insert their own membership (the RLS chicken-and-egg that
 *      makes owner bootstrap an operator action);
 *   3. the provisioning SQL attaches that user as owner;
 *   4. running it a second time changes nothing (no duplicate organization,
 *      profile or membership);
 *   5. the provisioned user can then read the organization and membership
 *      through RLS, exactly as `resolveActor()` does.
 *
 * Usage:
 *   npm i --no-save @electric-sql/pglite@0.2.17
 *   npm run verify:schema
 *
 * Nothing here connects to Supabase or reads any credential.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PGLITE_VERSION = '0.2.17';
const OWNER_EMAIL = 'owner@nibrexo.com';
const OWNER_ID = '11111111-2222-3333-4444-555555555555';

const root = resolve(import.meta.dirname, '..');

function fail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exitCode = 1;
}

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  fail(
    `This verification needs the optional dev tool @electric-sql/pglite@${PGLITE_VERSION}:\n    npm i --no-save @electric-sql/pglite@${PGLITE_VERSION}`,
  );
  process.exit(1);
}

const db = new PGlite();

/**
 * PGlite ships PostgreSQL 16 without the pgcrypto extension, but
 * `gen_random_uuid()` is built into core since PostgreSQL 13 — the only
 * pgcrypto feature the migrations use. The extension line is removed for this
 * local run only.
 */
function migrationSql(text) {
  return text.replace(
    /create extension if not exists "pgcrypto";/i,
    '-- pgcrypto: gen_random_uuid() is built into core PostgreSQL 13+',
  );
}

// --- minimal Supabase-compatible shims -------------------------------------
await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    created_at timestamptz not null default now()
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;
`);

// --- migrations, in order ---------------------------------------------------
for (const name of [
  '0001_core_identity.sql',
  '0002_modules.sql',
  '0003_manager_agent.sql',
  '0004_rls_policies.sql',
  '0005_rls_hardening.sql',
]) {
  await db.exec(migrationSql(readFileSync(resolve(root, 'supabase/migrations', name), 'utf8')));
  console.log(`  ✓ applied ${name}`);
}

// Supabase grants these to `authenticated`; RLS is what limits the rows.
await db.exec(`
  grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
`);

await db.exec(`insert into auth.users (id, email) values ('${OWNER_ID}', '${OWNER_EMAIL}');`);
console.log('  ✓ seeded the Supabase Auth user (no profile, no membership yet)');

// --- 1. before provisioning: RLS blocks and hides ---------------------------
await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER_ID}', false);`);
await db.exec('set role authenticated;');

const orgsBefore = await db.query('select count(*)::int as n from public.organizations');
const membershipsBefore = await db.query('select count(*)::int as n from public.memberships');
if (orgsBefore.rows[0].n !== 0 || membershipsBefore.rows[0].n !== 0) {
  fail('Expected a fresh database: an authenticated non-member must see no organizations.');
}
console.log('  ✓ authenticated non-member sees 0 organizations (matches NO_ORGANIZATION)');

let selfInsertBlocked = false;
try {
  await db.exec(`
    insert into public.memberships (organization_id, user_id, role)
    values (gen_random_uuid(), '${OWNER_ID}', 'owner');
  `);
} catch (error) {
  selfInsertBlocked = /row-level security/i.test(String(error));
}
if (!selfInsertBlocked) {
  fail('An authenticated non-member must NOT be able to insert their own membership.');
}
console.log('  ✓ authenticated non-member cannot self-provision (memberships_admin_write)');

await db.exec('reset role;');

// --- 2. provisioning SQL, rendered exactly like `--print-sql` ---------------
const { execFileSync } = await import('node:child_process');
const rendered = execFileSync(
  process.execPath,
  [
    resolve(root, 'node_modules/tsx/dist/cli.mjs'),
    resolve(root, 'scripts/provision-owner.ts'),
    `--email=${OWNER_EMAIL}`,
    '--print-sql',
  ],
  { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } },
);

await db.exec(rendered);
await db.exec(rendered); // second run must be a no-op

const state = await db.query(`
  select
    (select count(*)::int from public.organizations) as organizations,
    (select count(*)::int from public.profiles) as profiles,
    (select count(*)::int from public.memberships) as memberships,
    (select role::text from public.memberships limit 1) as role,
    (select slug from public.organizations limit 1) as slug
`);

const row = state.rows[0];
console.log(
  `  ✓ provisioning ran twice → organizations=${row.organizations} profiles=${row.profiles} memberships=${row.memberships} role=${row.role} slug=${row.slug}`,
);

if (row.organizations !== 1 || row.profiles !== 1 || row.memberships !== 1 || row.role !== 'owner') {
  fail('Provisioning must create exactly one organization, one profile and one owner membership.');
}

// --- 3. after provisioning: RLS now resolves the owner ---------------------
await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER_ID}', false);`);
await db.exec('set role authenticated;');

const ownerView = await db.query(`
  select
    (select count(*)::int from public.organizations) as organizations,
    (select count(*)::int from public.memberships) as memberships,
    public.is_org_member((select id from public.organizations limit 1)) as is_member,
    public.org_role_of((select id from public.organizations limit 1))::text as role,
    public.is_org_admin((select id from public.organizations limit 1)) as is_admin
`);
const view = ownerView.rows[0];
console.log(
  `  ✓ authenticated owner sees organizations=${view.organizations} memberships=${view.memberships} is_member=${view.is_member} role=${view.role} is_admin=${view.is_admin}`,
);

if (
  view.organizations !== 1 ||
  view.memberships !== 1 ||
  view.is_member !== true ||
  view.role !== 'owner' ||
  view.is_admin !== true
) {
  fail('The provisioned user must resolve to an owner through RLS.');
}

await db.exec('reset role;');

// --- 4. ambiguity guard -----------------------------------------------------
// A second organization plus a slug that matches nothing must be refused;
// the earlier run above already proved that a *unique* slug match is reused.
await db.exec(`insert into public.organizations (name, slug) values ('Other', 'other-org');`);
const ambiguousSql = execFileSync(
  process.execPath,
  [
    resolve(root, 'node_modules/tsx/dist/cli.mjs'),
    resolve(root, 'scripts/provision-owner.ts'),
    `--email=${OWNER_EMAIL}`,
    '--org-slug=no-such-org',
    '--print-sql',
  ],
  { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } },
);

let ambiguousRefused = false;
try {
  await db.exec(ambiguousSql);
} catch (error) {
  ambiguousRefused = /Refusing to guess/.test(String(error));
}
if (!ambiguousRefused) {
  fail('With several organizations, provisioning must refuse to guess.');
}
const after = await db.query('select count(*)::int as n from public.organizations');
if (after.rows[0].n !== 2) {
  fail('The ambiguity guard must not create another organization.');
}
console.log('  ✓ with 2 organizations and no slug match it refuses to guess and creates nothing');

if (process.exitCode === 1) {
  process.exit(1);
}
console.log('\n  ✓ schema + owner bootstrap verified against embedded PostgreSQL\n');
