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

`0005` is a corrective migration and must be applied after the original four migrations. Do
not edit an already-applied migration in the live project to make these changes.

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

Set these values in the deployment environment (not source control):

```bash
NEXT_PUBLIC_SUPABASE_URL=<project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<server-only-key> # jobs only
NIBREXO_DATA_BACKEND=supabase
NIBREXO_DEV_AUTH=0
```

Start the app and confirm `/api/health` reports `dataBackend: "supabase"` and
`configuration.supabase: true`. It must never report `memory` in production.

### 3. Auth and organization identity

1. Provision two test users and two organizations with memberships. Give one user access to
   organization A only and the other user access to organization B only.
2. Sign in through `/login`; confirm an authenticated user reaches `/manager`.
3. Confirm a user with no `memberships` row gets `NO_ORGANIZATION`, not workspace access.
4. Confirm a signed-out request receives the authenticated access state / API `401` response.

> Initial owner provisioning remains an operational prerequisite: this schema intentionally
> does not auto-assign a new signup to an arbitrary organization.

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
