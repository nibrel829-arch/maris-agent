# Supabase Verification Record

## Status on 2026-10-06

**Static repository verification: complete.**

**Live project verification: blocked.** No Supabase project reference, local Supabase
configuration, public Supabase environment variables, or service-role key was available in
this checkout. `npx supabase migration list` reports `Cannot find project ref. Have you run
supabase link?`; local Supabase startup is also unavailable because Docker/Podman is not
available in this environment.

This repository must **not** be described as production-ready for Supabase until the live
checks below are performed against the attached project.

## Status on 2026-10-07 — owner membership

**Production login works** (Supabase Auth). The app then reported
`NO_ORGANIZATION` — "Your account is not a member of any organization. …" — because the
authenticated user had no `public.memberships` row. The authorization chain was verified in
code and reproduced in tests; an idempotent, secret-safe owner provisioning path (service-role
CLI + SQL-editor script) was added, together with authorization-path tests.

**Still pending on the live project:** the provisioning write itself. This checkout has no
Supabase URL, project ref, public key or server-only key, and the signed-in user's UUID
cannot be read without them, so the live attach must be executed by an operator with
credentials (Path A) or in the Supabase SQL editor (Path B). See "Owner membership
authorization" below.

## What was inspected

| Area | Repository result |
| --- | --- |
| Environment boundary | `.env.example` requires public URL/anon key and keeps the service-role key server-only. `NIBREXO_DATA_BACKEND=memory` is refused when `NODE_ENV=production`. |
| Auth boundary | Server actor resolution calls `auth.getUser()`, then resolves `memberships` and `profiles`; the browser login uses Supabase password sign-in and session refresh middleware. |
| Organization identity | `0001_core_identity.sql` defines `organizations`, `profiles`, `memberships`, `is_org_member`, and `org_role_of`. |
| Module data | `0002_modules.sql` defines tenant-scoped CRM, content, social, email and related tables. |
| Manager persistence | `0003_manager_agent.sql` defines `ai_tasks`, `ai_actions`, `ai_memory`, `approvals`, research/product artifacts and quality reports. The repository maps a task snapshot to `ai_tasks` and tools write artifacts to their own tables. |
| Baseline RLS | `0004_rls_policies.sql` enables tenant RLS for the documented tenant tables and scopes reads/inserts by membership. |
| RLS follow-up | `0005_rls_hardening.sql` corrects additive-policy gaps in 0004 for approval updates, task updates, social credential access, settings, audit mutability and tenant-key changes. |
| Audit persistence | `activity_logs` is append-only in 0005. The Supabase repository no longer sends an `updated_at` field to this table, which does not have that column. |

## Migration order

Apply migrations in this exact order:

1. `0001_core_identity.sql`
2. `0002_modules.sql`
3. `0003_manager_agent.sql`
4. `0004_rls_policies.sql`
5. `0005_rls_hardening.sql`
6. `0006_clients_crm.sql`
7. `0007_content_storage.sql`

`0005` is a corrective migration and must be applied after the original four migrations. Do
not edit an already-applied migration in the live project to make these changes.
`0006` is additive only (a nullable column, three enum values, one index) and leaves RLS untouched.
`0007` creates the private `nibrexo-media` bucket and org-scoped storage policies; its blocks
skip with a notice on databases without the Supabase `storage` schema.

## Live verification runbook

Use a non-production verification project or a safely isolated test organization. Do not put
keys in Git or browser-facing variables.

### 1. Attach and apply

```bash
supabase link --project-ref <attached-project-ref>
supabase migration list
supabase db push
supabase migration list
```

Expected result: all five migrations appear as applied in order.

### 2. Configure the application

Set these values in the **Production** deployment environment (not source control):

```bash
NEXT_PUBLIC_SUPABASE_URL=<project-url>
# Use one public key name. The current Vercel/Supabase integration normally supplies this:
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
# Legacy projects may use this instead:
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Server-only privileged jobs: one of these names is sufficient.
SUPABASE_SECRET_KEY=<server-only-secret-key>
# or legacy SUPABASE_SERVICE_ROLE_KEY=<server-only-service-role-key>

NIBREXO_DATA_BACKEND=supabase
NIBREXO_DEV_AUTH=0
```

Redeploy after changing Production variables: Vercel builds snapshot `NEXT_PUBLIC_` values at
build time. Confirm `/api/health` reports `dataBackend: "supabase"`,
`configuration.supabase: true`, and `supabasePublicKeySource` as the expected variable name.
The endpoint returns names/statuses only, never URLs or key material. It must never report
`memory` in production.

### 3. Auth and organization identity

1. Provision two test users and two organizations with memberships. Give one user access to
   organization A only and the other user access to organization B only.
2. Sign in through `/login`; confirm an authenticated user reaches `/manager`.
3. Confirm a user with no `memberships` row gets `NO_ORGANIZATION`, not workspace access.
4. Confirm a signed-out request receives the authenticated access state / API `401` response.

> Initial owner provisioning remains an operational prerequisite: this schema intentionally
> does not auto-assign a new signup to an arbitrary organization. Use the provisioning
> section below to attach the first owner.

## Incident 2026-10-07 — `42704: type "public.org_role" does not exist`

### Symptom

`supabase/scripts/provision_owner.sql` stopped on `v_role public.org_role := 'owner';` with:

```
ERROR: 42704: type "public.org_role" does not exist
```

### Diagnosis

`public.org_role` is created in exactly one place: the guarded `do $$` block in
`supabase/migrations/0001_core_identity.sql` (line 29), and `public.memberships.role` is
typed as `public.org_role`. The bootstrap declares `v_role public.org_role` **because that is
the repository's schema** — a `42704` there means the live project has no such type, so
migration `0001` (and therefore `0002`–`0007`, which all reference `organizations`) has not
been applied to the project the app and the SQL Editor are pointed at. The repository has never
been able to prove otherwise: `docs/SUPABASE_VERIFICATION.md` (2026-10-06) records that no
project ref, public key or service key was ever available to it, so `supabase migration list` /
`supabase db push` were never run.

The same missing schema explains the application symptom: the deployed build's
`memberships` lookup fails (`relation "public.memberships" does not exist`) and the
pre-fix `resolveActor()` collapsed *any* read error into
`NO_ORGANIZATION` — "not a member of any organization". PR #4 separates those two states
(`MEMBERSHIP_LOOKUP_FAILED` vs `NO_ORGANIZATION`), so a missing schema can no longer be
mistaken for a missing invitation.

### Confirm it (read-only, no secrets)

Run `supabase/scripts/diagnose_schema.sql` in the SQL Editor. It only reads catalogs and never
touches the Nibrexo tables, so it works even when everything is missing. Expected output on an
unmigrated project: `status = MISSING` for `public.org_role`, `public.organizations`,
`public.profiles`, `public.memberships` (and the rest of the list), `public_tables = 0`,
`public_enums = 0`, no rows in "TABLES + RLS", plus a notice that
`supabase_migrations.schema_migrations` does not exist (the CLI has never pushed anything).

A partially applied project shows a mix; the rule is simply that **every row of Grid 1 must be
`ok` before provisioning**. `public_enums` is a good single indicator: a fully applied
`0001`–`0007` set creates 14 enums (`0001`: 2, `0002`: 7, `0003`: 5; `0006` adds enum *values*, not types; `0007` only touches the storage schema).

### Remediation — apply the repository migrations, then re-run the bootstrap unchanged

Nothing is deleted, no project is recreated, no object is created by hand. All seven migrations
are safely re-runnable: every `create table` / `create index` / `add column` is `if not exists`, every
`create type` is guarded by a `pg_type` check, every `add value` is `if not exists`, and the only `drop` statements are
`drop policy if exists` (policy metadata, never rows). `0004`/`0005` only add RLS policies and
immutability triggers, so applying them strengthens security and cannot weaken RLS.

**Path A — Supabase CLI (the documented deployment workflow):**

```bash
supabase login                      # browser flow; no secret is pasted anywhere
supabase link --project-ref <your-project-ref>
supabase migration list              # local vs remote: shows 0001-0007 as not applied
supabase db push                     # applies 0001 -> 0007 in order, records them
supabase migration list              # expect all seven applied
```

**Path B — SQL Editor, no CLI (single paste):**

```bash
npm run db:sql     # writes ./all_migrations.sql: 0001 -> 0007, concatenated in order
```

Paste that file into the SQL Editor and run it once. It is a generated concatenation of
`supabase/migrations/*.sql` — the migration files remain the single source of truth, so it
cannot drift from `supabase db push`; never edit the generated file. Alternatively paste the
seven files one at a time, in this order: `0001_core_identity.sql`, `0002_modules.sql`,
`0003_manager_agent.sql`, `0004_rls_policies.sql`, `0005_rls_hardening.sql`,
`0006_clients_crm.sql`, `0007_content_storage.sql`.

Either way, run `supabase/scripts/diagnose_schema.sql` again and confirm Grid 1 is entirely
`ok`.

**Re-applying is safe.** Verified in `npm run verify:schema`: the set was applied **three times
in a row** to the same database with identical objects afterwards (34 tables, 14 enums, 126
policies, 31 triggers). Two gaps that made a second application fail with
`42710: policy … already exists` were corrected in `0005_rls_hardening.sql` — it now drops
`ai_tasks_requester_insert`, `ai_tasks_requester_update`, `social_credentials_admin_insert`,
`social_credentials_admin_update`, and the three `settings_admin_*` policies before creating
them. `drop policy if exists` on a policy that does not exist is a no-op, so for any project
that already has `0005` applied this change is inert. `tests/unit/supabase-contract.test.ts`
now enforces that every policy either migration creates is dropped first, and that no
migration ever drops a table/column/type or deletes rows.

**Then, unchanged:** `supabase/scripts/provision_owner.sql` with the login email filled in on
its config and verification lines. The bootstrap now begins with a read-only preflight that
stops with the missing-object list and this exact guidance instead of a bare `42704`; it never
creates the enum or any table. Verified in `npm run verify:schema`: on an unmigrated database
the preflight fires, creates zero objects, and after the migrations the bootstrap creates
exactly one organization, one profile and one owner membership, twice in a row with no
duplicates.

### What to check if `public.org_role` is missing but the tables already exist

That combination cannot come from the migrations (`memberships.role` is typed as the enum), so
it means objects were created outside them. Grid 4 of the diagnostic lists same-named types in
other schemas — the `0001` guard matches `typname` without a schema filter. In that case stop
and reconcile before provisioning rather than dropping anything: the tables hold data.

## Owner membership authorization (`NO_ORGANIZATION`)

### Finding (2026-10-07)

The production Supabase Auth login succeeds, but every workspace route renders:

> Your account is not a member of any organization. Ask an owner or admin to invite you.

That string is produced by `resolveActorFromRecords()`
(`src/server/auth/authorization.ts`) when the authenticated `auth.users` row has no
`public.memberships` row. Supabase Auth is working; the user is simply not attached to a
tenancy yet. Verified in code against the real query path
(`src/server/auth/actor.ts` → `memberships` by `user_id`, then `profiles` by `id`) and
covered by `tests/unit/actor-resolution.test.ts`.

The signed-in user cannot repair this from the UI, by design: policy
`memberships_admin_write` (`0004_rls_policies.sql`) is
`for all using (public.is_org_admin(organization_id))`, so membership rows may only be
written by an existing owner/admin of that same organization. Bootstrapping the first owner
is an operator action. No public signup flow exists, and none was added.

Schema involved (all pre-existing):

| Table / helper | Role in the chain |
| --- | --- |
| `auth.users` | Supabase Auth identity (`profiles.id` / `memberships.user_id` reference it) |
| `public.organizations` | Tenant: `id`, `name`, unique `slug` |
| `public.profiles` | `id` → `auth.users`, `full_name` (presentation only; missing never blocks access) |
| `public.memberships` | `organization_id` + `user_id` + `role`, unique `(organization_id, user_id)` |
| `public.org_role` | `owner` \| `admin` \| `member` \| `client` |
| `is_org_member`, `org_role_of`, `is_org_admin` | RLS helpers used by every policy |

### Fix — attach the existing auth user as owner of the single Nibrexo organization

Both paths below are idempotent: they reuse the existing organization when one exists, create
one only when the project has none, create a profile only when it is missing, and
create/promote exactly one membership. They never create an auth user, never delete anything,
never downgrade an owner and never modify RLS policies. Neither prints or stores secrets.

**Path A — service-role CLI (tested, recommended).** Provide the server-only secret key in
the local environment or `.env.local` (never commit it):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co   # public
SUPABASE_SECRET_KEY=<server-only secret>                     # never printed

npm run auth:status    -- --email=<login email>              # read-only diagnosis
npm run auth:provision -- --email=<login email> --apply      # attach as owner
```

`auth:status` prints the project host, the auth user id, a masked email, every organization,
the profile row and every membership, then replays the exact chain
(`resolveActorFromRecords` + `checkPermission`) and reports `ok`/`FAIL` per link. Use
`--user-id=<uuid>` instead of `--email`, and `--role=admin` if admin (not owner) is intended.

**Path B — SQL editor (no credentials needed).** Renders the same guarantees as SQL:

```bash
npm run auth:status -- --email=<login email> --print-sql > provision_owner.sql
# Supabase Dashboard → SQL Editor → paste → Run
```

The canonical file is `supabase/scripts/provision_owner.sql` (operator script, deliberately
outside `supabase/migrations/` so `supabase db push` can never grant a role). It refuses to
run for the `anon`/`authenticated` roles, refuses to guess when several organizations exist
and none uniquely matches the slug, and prints a verification result set.

### Database-level proof of the bootstrap (no live project needed)

`npm run verify:schema` runs the five real migrations followed by the real
`supabase/scripts/provision_owner.sql` against an embedded PostgreSQL
(`@electric-sql/pglite`; install with `npm i --no-save @electric-sql/pglite@0.2.17`).
It proves, in PostgreSQL itself:

- all five migrations apply in order to an empty database;
- an authenticated user with no membership sees zero organizations and **cannot insert
  their own membership** (the RLS chicken-and-egg is real, not theoretical);
- the bootstrap SQL creates exactly one organization (`nibrexo`), one profile row and one
  `owner` membership — and **running it a second time changes nothing**;
- the provisioned user then resolves through RLS: `is_org_member` true, `org_role_of` =
  `owner`, `is_org_admin` true — the exact helpers `resolveActor()` and the RLS policies use;
- with several organizations and no unique slug match it raises instead of guessing and
  creates nothing.

The only deviation from Supabase is the `create extension "pgcrypto"` line, removed for the
local run because PGlite has no pgcrypto while `gen_random_uuid()` is built into core
PostgreSQL 13+.

### Verification after provisioning

`npm run auth:provision` ends with the verified chain: Supabase Auth session `ok` → profile
`ok` → organization `nibrexo` → membership `owner` → `resolveActor` role `owner` →
`dashboard.view` / `settings.edit` `ok` → exactly one organization, one profile row and one
membership in the target organization. Then sign in at `/login`: `/manager` and `/dashboard`
authorize.

Nothing further is missing in code. The only step that cannot be performed from a repository
checkout without credentials is the live write itself, which needs the project's server-only
key (Path A) or the SQL editor (Path B).

### 4. RLS and tenant isolation

With a real user-session JWT for organization A, verify all of the following against PostgREST
or through the application API:

- organization A can list its own `clients`, `ai_tasks`, `approvals`, `activity_logs` and
  artifacts;
- organization A receives no rows for organization B;
- an attempted `id + organization_id` update targeting organization B updates zero rows;
- a regular member cannot update `approvals`, `settings` or `social_credentials`;
- an owner/admin can decide an approval in its own organization only;
- `activity_logs` rejects `UPDATE` and `DELETE`;
- updates attempting to change any tenant `organization_id` are rejected by the immutable-key
  trigger.

### 5. Manager persistence and decision flow

1. Create a research task from `/manager`.
2. Verify a row in `ai_tasks`, the corresponding research artifact row, and `activity_logs`
   entries for task creation/completion.
3. Create an external-email request. Verify it stops in `WAITING_APPROVAL`, creates an
   `approvals` row, and does not claim delivery before a decision.
4. Approve as an owner/admin, resume, and verify the same `ai_tasks` row advances without a
   duplicate external action.
5. Reject and expire separate requests to verify both paths cannot execute the protected step.
6. Verify unsupported social integrations and unconfigured email providers report their real
   `unsupported` / `not_configured` states.

## Automated coverage available in this repository

`npm test` includes repository-level tenant filtering, Manager task/artifact persistence,
approval lifecycle, resume behavior, audit logging, permission guards, unsupported/not-configured
behavior and static migration contract checks. These tests use the intentionally non-production
memory repository; they do **not** prove a remote Supabase project's RLS configuration. The live
runbook above is required for that proof.

Authorization-specific coverage added with the owner-membership fix:

| Test file | What it locks down |
| --- | --- |
| `tests/unit/authorization.test.ts` | The `NO_ORGANIZATION` contract and message, `MEMBERSHIP_LOOKUP_FAILED` as a distinct state, unknown role coercion, missing-profile tolerance, and that a provisioned owner passes (and a member still fails) the real permission guards |
| `tests/unit/actor-resolution.test.ts` | `resolveActor()` / `resolveActorFromToken()` against a mocked Supabase client: no membership → `NO_ORGANIZATION`, read error → `MEMBERSHIP_LOOKUP_FAILED`, no session → `UNAUTHENTICATED`, owner/admin resolution |
| `tests/unit/provisioning.test.ts` | The idempotent provisioning plan (no duplicate organization/profile/membership, no owner downgrade, ambiguity refusal, second run is a no-op) and the SQL bootstrap artifact contract |
| `tests/integration/authorization-flow.test.ts` | The real route handlers: dashboard API `403 NO_ORGANIZATION` before provisioning, `200` for the owner afterwards, Manager task creation `201`, `401` without a session |
| `npm run verify:schema` | Migrations + bootstrap executed in a real PostgreSQL (PGlite), including the RLS behaviour above |
