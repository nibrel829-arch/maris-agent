#!/usr/bin/env node
/**
 * Database-level verification of the Nibrexo schema + owner bootstrap.
 *
 * Runs the real migrations (0001-0012) and the real
 * `supabase/scripts/provision_owner.sql` against an embedded PostgreSQL
 * (@electric-sql/pglite, PostgreSQL compiled to WASM) with a minimal
 * Supabase-compatible `auth` shim. It proves, without touching the live
 * project:
 *
 *   1. all ten migrations apply in order to an empty database;
 *   2. an authenticated user with no membership cannot read the organization
 *      and cannot insert their own membership (the RLS chicken-and-egg that
 *      makes owner bootstrap an operator action);
 *   3. the provisioning SQL attaches that user as owner and remains idempotent;
 *   4. tenant users see only their organization's inbox conversations,
 *      messages, participants and sync/reply records, while webhook receipts
 *      remain admin-readable;
 *   5. composite inbox foreign keys reject cross-tenant client/participant links;
 *   6. the generated single-paste schema has the same objects and is rerunnable.
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
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
      create role service_role nologin bypassrls;
    end if;
  end $$;
`);

await db.exec(`insert into auth.users (id, email) values ('${OWNER_ID}', '${OWNER_EMAIL}');`);
console.log('  ✓ seeded the Supabase Auth user (no profile, no membership yet)');

// --- 0. schema NOT applied yet: the live `42704` situation ------------------
// `--print-sql` output is rendered once and reused, exactly like the operator
// pasting one file into the SQL Editor. Against a project without the
// migrations, the bootstrap must stop with an actionable message and create
// nothing (this reproduces the production failure being diagnosed).
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

let preflightMessage = null;
try {
  await db.exec(rendered);
} catch (error) {
  preflightMessage = String(error);
}
if (!preflightMessage) {
  fail('Without migrations the bootstrap must fail loudly, not silently succeed.');
}
if (!/not fully applied to this project/.test(preflightMessage)) {
  fail('Without migrations the bootstrap must stop with the schema preflight message (not a bare 42704).');
}
if (!/public\.org_role/.test(preflightMessage)) {
  fail('The preflight message must name the missing object (public.org_role).');
}
const nothingCreated = await db.query(
  `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`,
);
if (nothingCreated.rows[0].n !== 0) {
  fail('The preflight must not create anything when the schema is missing.');
}
console.log('  ✓ without migrations: clear preflight message, zero objects created (no bare 42704)');

// The read-only diagnostic must work in exactly this broken state.
const diagnoseSql = readFileSync(resolve(root, 'supabase/scripts/diagnose_schema.sql'), 'utf8');
const brokenDiagnosis = await db.exec(diagnoseSql);
const brokenObjects = brokenDiagnosis[0]?.rows ?? [];
const missingNames = brokenObjects
  .filter((entry) => entry.status === 'MISSING')
  .map((entry) => entry.object_name);
if (!missingNames.includes('public.org_role')) {
  fail('diagnose_schema.sql must report public.org_role as MISSING on an unmigrated project.');
}
if (!missingNames.includes('public.memberships') || missingNames.length < 10) {
  fail('diagnose_schema.sql must report the whole missing identity and module schema.');
}
console.log(
  `  ✓ diagnose_schema.sql on the unmigrated project: ${missingNames.length} objects reported MISSING (incl. public.org_role)`,
);

// --- migrations, in order ---------------------------------------------------
for (const name of [
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
  '0012_email_design_studio.sql',
]) {
  await db.exec(migrationSql(readFileSync(resolve(root, 'supabase/migrations', name), 'utf8')));
  console.log(`  ✓ applied ${name}`);
}

// Supabase grants these to `authenticated`; RLS is what limits the rows.
await db.exec(`
  grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
`);

// The same diagnostic on the migrated project must report everything ok.
const goodDiagnosis = await db.exec(diagnoseSql);
const goodObjects = goodDiagnosis[0]?.rows ?? [];
const stillMissing = goodObjects.filter((entry) => entry.status === 'MISSING');
if (stillMissing.length > 0) {
  fail(`diagnose_schema.sql still reports missing objects after migrations: ${stillMissing.map((e) => e.object_name).join(', ')}`);
}
console.log(`  ✓ diagnose_schema.sql after migrations: all ${goodObjects.length} required objects present`);

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

// --- 2. provisioning SQL (rendered above), now that the schema exists -------
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

// --- 5. Unified Inbox RLS + relationship isolation -------------------------
const tenantA = (await db.query(`select id from public.organizations where slug = 'nibrexo'`)).rows[0].id;
const tenantB = (await db.query(`select id from public.organizations where slug = 'other-org'`)).rows[0].id;
const accountA = 'aaaaaaaa-1111-4111-8111-111111111111';
const accountB = 'bbbbbbbb-2222-4222-8222-222222222222';
const clientA = 'cccccccc-3333-4333-8333-333333333333';
const clientB = 'dddddddd-4444-4444-8444-444444444444';
const conversationA = 'eeeeeeee-5555-4555-8555-555555555555';
const conversationB = 'ffffffff-6666-4666-8666-666666666666';
const participantA = '11111111-aaaa-4aaa-8aaa-111111111111';
const participantB = '22222222-bbbb-4bbb-8bbb-222222222222';
const messageA = '33333333-cccc-4ccc-8ccc-333333333333';
const messageB = '44444444-dddd-4ddd-8ddd-444444444444';
const memberId = '55555555-eeee-4eee-8eee-555555555555';
await db.exec(`
  insert into public.social_accounts (id, organization_id, platform, external_account_id, name, status)
  values ('${accountA}', '${tenantA}', 'youtube', 'YT-TENANT-A', 'Tenant A channel', 'connected'),
         ('${accountB}', '${tenantB}', 'youtube', 'YT-TENANT-B', 'Tenant B channel', 'connected');
  insert into public.clients (id, organization_id, name)
  values ('${clientA}', '${tenantA}', 'Tenant A client'), ('${clientB}', '${tenantB}', 'Tenant B client');
  insert into public.conversations
    (id, organization_id, account_id, platform, external_thread_id, participant_name, kind, client_id, is_read)
  values ('${conversationA}', '${tenantA}', '${accountA}', 'youtube', 'YT-THREAD-A', 'Viewer A', 'comment_thread', '${clientA}', false),
         ('${conversationB}', '${tenantB}', '${accountB}', 'youtube', 'YT-THREAD-B', 'Viewer B', 'comment_thread', '${clientB}', false);
  insert into public.inbox_participants (id, organization_id, conversation_id, external_participant_id, display_name)
  values ('${participantA}', '${tenantA}', '${conversationA}', 'VIEWER-A', 'Viewer A'),
         ('${participantB}', '${tenantB}', '${conversationB}', 'VIEWER-B', 'Viewer B');
  insert into public.messages (id, organization_id, conversation_id, external_message_id, direction, kind, body, participant_id)
  values ('${messageA}', '${tenantA}', '${conversationA}', 'YT-COMMENT-A', 'inbound', 'comment', 'A only', '${participantA}'),
         ('${messageB}', '${tenantB}', '${conversationB}', 'YT-COMMENT-B', 'inbound', 'comment', 'B only', '${participantB}');
  insert into public.inbox_sync_states (organization_id, account_id, platform)
  values ('${tenantA}', '${accountA}', 'youtube'), ('${tenantB}', '${accountB}', 'youtube');
  insert into public.inbox_reply_attempts
    (organization_id, account_id, conversation_id, idempotency_key, request_hash, status)
  values ('${tenantA}', '${accountA}', '${conversationA}', 'tenant-a-reply-key', 'hash-a', 'failed'),
         ('${tenantB}', '${accountB}', '${conversationB}', 'tenant-b-reply-key', 'hash-b', 'failed');
  insert into public.inbox_webhook_receipts
    (organization_id, account_id, provider_event_key, event_type, status)
  values ('${tenantA}', '${accountA}', 'event-a', 'page.feed', 'processed'),
         ('${tenantB}', '${accountB}', 'event-b', 'page.feed', 'processed');
  insert into auth.users (id, email) values ('${memberId}', 'member@nibrexo.com');
  insert into public.memberships (organization_id, user_id, role)
  values ('${tenantA}', '${memberId}', 'member');
`);

await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER_ID}', false);`);
await db.exec('set role authenticated;');
const ownerInboxRows = await db.query(`
  select
    (select count(*)::int from public.conversations) as conversations,
    (select count(*)::int from public.messages) as messages,
    (select count(*)::int from public.inbox_participants) as participants,
    (select count(*)::int from public.inbox_sync_states) as sync_states,
    (select count(*)::int from public.inbox_reply_attempts) as reply_attempts,
    (select count(*)::int from public.inbox_webhook_receipts) as webhook_receipts,
    (select count(*)::int from public.clients) as clients
`);
const ownerInbox = ownerInboxRows.rows[0];
if (Object.values(ownerInbox).some((value) => value !== 1)) {
  fail(`Owner should see one row in each of its inbox/CRM resources, not another tenant: ${JSON.stringify(ownerInbox)}`);
}
await db.exec('reset role;');
await db.exec(`select set_config('request.jwt.claim.sub', '${memberId}', false);`);
await db.exec('set role authenticated;');
const memberInboxRows = await db.query(`
  select
    (select count(*)::int from public.conversations) as conversations,
    (select count(*)::int from public.messages) as messages,
    (select count(*)::int from public.inbox_participants) as participants,
    (select count(*)::int from public.inbox_sync_states) as sync_states,
    (select count(*)::int from public.inbox_reply_attempts) as reply_attempts,
    (select count(*)::int from public.inbox_webhook_receipts) as webhook_receipts
`);
const memberInbox = memberInboxRows.rows[0];
if (
  memberInbox.conversations !== 1 || memberInbox.messages !== 1 ||
  memberInbox.participants !== 1 || memberInbox.sync_states !== 1 ||
  memberInbox.reply_attempts !== 1 || memberInbox.webhook_receipts !== 0
) {
  fail(`Member tenant reads should be scoped, and webhook receipts admin-only: ${JSON.stringify(memberInbox)}`);
}
let memberIngestBlocked = false;
try {
  await db.exec(`
    insert into public.conversations (organization_id, platform, external_thread_id, kind)
    values ('${tenantA}', 'youtube', 'MEMBER-CANNOT-INGEST', 'comment_thread');
  `);
} catch (error) {
  memberIngestBlocked = /row-level security/i.test(String(error));
}
if (!memberIngestBlocked) fail('A tenant member must not directly ingest conversations through PostgREST.');
let memberMessageInsertBlocked = false;
try {
  await db.exec(`
    insert into public.messages (organization_id, conversation_id, external_message_id, direction, kind)
    values ('${tenantA}', '${conversationA}', 'MEMBER-CANNOT-INGEST', 'inbound', 'comment');
  `);
} catch (error) {
  memberMessageInsertBlocked = /row-level security/i.test(String(error));
}
if (!memberMessageInsertBlocked) fail('A tenant member must not directly ingest provider messages through PostgREST.');
await db.exec('reset role;');

let crossTenantClientBlocked = false;
try {
  await db.exec(`
    insert into public.conversations (organization_id, account_id, platform, external_thread_id, client_id)
    values ('${tenantA}', '${accountA}', 'youtube', 'CROSS-TENANT-CLIENT', '${clientB}');
  `);
} catch (error) {
  crossTenantClientBlocked = /foreign key/i.test(String(error));
}
if (!crossTenantClientBlocked) fail('The composite conversation/client foreign key must reject cross-tenant links.');
let crossTenantParticipantBlocked = false;
try {
  await db.exec(`
    insert into public.messages (organization_id, conversation_id, external_message_id, direction, participant_id)
    values ('${tenantA}', '${conversationA}', 'CROSS-TENANT-PARTICIPANT', 'inbound', '${participantB}');
  `);
} catch (error) {
  crossTenantParticipantBlocked = /foreign key/i.test(String(error));
}
if (!crossTenantParticipantBlocked) fail('The composite message/participant foreign key must reject cross-tenant links.');
console.log('  ✓ inbox RLS scopes owner/member reads by organization, keeps receipts admin-only, and rejects cross-tenant CRM/participant links');

// --- 6. Publish claim function: single-flight handoff -----------------------
// A due queued row is claimed exactly once: the first call flips it to
// publishing with a lease, the second call (lease still fresh) returns
// nothing. This is the sweeper's exactly-one-worker guarantee.
const claimOrg = (
  await db.query(`select id from public.organizations order by created_at asc limit 1`)
).rows[0].id;
const claimContent = (
  await db.query(
    `insert into public.content_items (organization_id, title) values ('${claimOrg}', 'Claim probe') returning id`,
  )
).rows[0].id;
const claimAccount = (
  await db.query(
    `insert into public.social_accounts (organization_id, platform, external_account_id, name, status)
     values ('${claimOrg}', 'facebook', 'probe-page', 'Probe Page', 'connected') returning id`,
  )
).rows[0].id;
await db.query(
  `insert into public.publish_jobs (organization_id, content_id, account_id, platform, status, run_at, idempotency_key)
   values ('${claimOrg}', '${claimContent}', '${claimAccount}', 'facebook', 'queued', now() - interval '1 minute', 'probe-key-1')`,
);
const firstClaim = await db.query(
  `select id, status, attempts from public.claim_due_publish_jobs(now(), 300, 10)`,
);
if (firstClaim.rows.length !== 1) {
  fail(`claim_due_publish_jobs returned ${firstClaim.rows.length} rows, expected 1.`);
}
if (firstClaim.rows[0].status !== 'publishing' || firstClaim.rows[0].attempts !== 1) {
  fail('claim_due_publish_jobs must flip the row to publishing and bump attempts.');
}
const secondClaim = await db.query(
  `select id from public.claim_due_publish_jobs(now(), 300, 10)`,
);
if (secondClaim.rows.length !== 0) {
  fail('claim_due_publish_jobs handed the same job to a second sweeper.');
}
console.log('  ✓ claim_due_publish_jobs: due row claimed once (publishing, attempts=1), second claim empty');

// --- 7. SQL-Editor path: one generated script, one paste --------------------
// `npm run db:sql` output must produce exactly the same schema as applying the
// migration files individually, which is what a SQL-Editor operator pastes.
const { loadMigrations, renderMigrations } = await import('./lib/migrations-sql.mjs');
const singlePaste = renderMigrations(loadMigrations(root, migrationSql));

const fresh = new PGlite();
await fresh.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$;
`);
await fresh.exec(singlePaste);
const pasteDiagnosis = await fresh.exec(diagnoseSql);
const pasteMissing = (pasteDiagnosis[0]?.rows ?? []).filter((entry) => entry.status === 'MISSING');
if (pasteMissing.length > 0) {
  fail(
    `npm run db:sql output does not build the full schema: ${pasteMissing
      .map((entry) => entry.object_name)
      .join(', ')}`,
  );
}
const pasteEnums = await fresh.query(
  `select count(*)::int as n from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'`,
);
if (pasteEnums.rows[0].n !== 14) {
  fail(`npm run db:sql output created ${pasteEnums.rows[0].n} enums, expected 14.`);
}
// Idempotent: a retry after a partial failure (or a second paste) must produce
// no error and no duplicate object.
const countObjects = async (target) => {
  const { rows } = await target.query(`
    select
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r') as tables,
      (select count(*)::int from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype = 'e') as enums,
      (select count(*)::int from pg_policies where schemaname = 'public') as policies,
      (select count(*)::int from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not tg.tgisinternal) as triggers
  `);
  return rows[0];
};

const firstCounts = await countObjects(fresh);
await fresh.exec(singlePaste);
await fresh.exec(singlePaste);
const repeatCounts = await countObjects(fresh);
if (JSON.stringify(firstCounts) !== JSON.stringify(repeatCounts)) {
  fail(
    `Re-applying the migration set changed the schema: ${JSON.stringify(firstCounts)} -> ${JSON.stringify(repeatCounts)}`,
  );
}
console.log(
  `  ✓ npm run db:sql single-paste output: full schema (${firstCounts.tables} tables, ${firstCounts.enums} enums, ${firstCounts.policies} policies), re-runnable 3x with identical objects`,
);

if (process.exitCode === 1) {
  process.exit(1);
}
console.log('\n  ✓ schema + owner bootstrap verified against embedded PostgreSQL\n');
