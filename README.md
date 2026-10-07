# Nibrexo OS AI — CEO / Manager Agent

One central autonomous Manager/CEO operating brain for Nibrexo, with modular
skills, orchestration, verification, quality control and business operations.

Built with **Next.js (App Router) + TypeScript**, deployed on **Vercel**, backed
by **Supabase** (Auth, PostgreSQL, RLS), using the **Vercel AI SDK**.

> Specification sources: the 12-document Nibrexo OS AI PDF set in this
> repository (v1.0) and `docs/CEO_MANAGER_AGENT_V2_SPEC.md` (V2 Manager layer).
> Architecture decisions and conflict resolutions: `docs/ARCHITECTURE.md`.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in your values
npm run dev                    # http://localhost:3000
```

### Running without Supabase

The full product requires Supabase. For local development and evaluation:

```bash
NIBREXO_DATA_BACKEND=memory
NIBREXO_DEV_AUTH=1
```

Both are refused when `NODE_ENV=production`, so real data can never be silently
written to a disposable store.

### Running with Supabase

1. Create a Supabase project.
2. Link the attached project, then apply the migrations in order:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   supabase migration list
   ```
   The current migration set is `0001` through `0008`; `0005` hardens RLS policies, `0006` adds the Phase 5 CRM fields (`clients.phone`, new `client_status` values), `0007` creates the Phase 6 private media bucket with storage RLS, and `0008` adds the Phase 7 social OAuth states plus encrypted credential columns.
   Without the CLI, generate one ordered script and paste it into the SQL Editor once:
   ```bash
   npm run db:sql          # writes ./all_migrations.sql (pure SQL, no banner)
   ```
4. Verify the schema actually landed before doing anything else: run
   `supabase/scripts/diagnose_schema.sql` in the Supabase SQL Editor (read-only). Every row of
   the "REQUIRED OBJECTS" grid must read `ok`. A missing `public.org_role` means migration
   `0001` never reached this project — apply the migrations before continuing, and never
   create the type by hand.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (current Supabase/Vercel integration) or `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy).
6. For server-side jobs only, set `SUPABASE_SECRET_KEY` (current) or `SUPABASE_SERVICE_ROLE_KEY` (legacy); both remain server-only secrets.
7. Attach the first owner (see below) — an authenticated user without an organization
   membership gets `NO_ORGANIZATION` on every workspace route, by design.

### First owner (organization membership)

**Prerequisite:** migrations `0001`–`0008` applied and confirmed with
`supabase/scripts/diagnose_schema.sql` (step 4). Without them the bootstrap stops at its
read-only preflight listing what is missing — it never creates schema objects itself, because
`public.org_role` and the identity tables belong to migration `0001`.

There is no public signup flow: `memberships_admin_write` (`0004_rls_policies.sql`) only
lets an existing owner/admin write membership rows, so bootstrapping the first owner is an
operator action. Both commands below are idempotent — they reuse the existing organization,
never create a duplicate profile/membership and never modify RLS.

```bash
# A. service-role CLI (reads .env.local; nothing is printed except ids/slug names)
npm run auth:status    -- --email=<login email>            # read-only diagnosis
npm run auth:provision -- --email=<login email> --apply    # attach as owner

# B. no credentials: emit the equivalent SQL for the Supabase SQL editor
npm run auth:status -- --email=<login email> --print-sql > provision_owner.sql
```

### Enabling the AI layer

Set `OPENAI_API_KEY` (and optionally `NIBREXO_AI_MODEL`). Without it the Manager
runs its deterministic planner and records `aiEnabled: false` on every task —
it never emulates a model response.

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server on `0.0.0.0:3000` |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite |
| `npm run lint` | ESLint |
| `npm run auth:status` | Read-only owner/organization/membership diagnosis (`-- --email=…`) |
| `npm run auth:provision` | Attach the first owner (`-- --email=… --apply`); `--print-sql` needs no credentials |
| `npm run db:sql` | Write `all_migrations.sql` (0001–0008 in order) for a single SQL-Editor paste |
| `npm run db:sql:stdout` | Print the same bundle to stdout instead of a file |
| `npm run verify:schema` | Runs migrations + owner bootstrap against embedded PostgreSQL (needs `npm i --no-save @electric-sql/pglite@0.2.17`) |

---

## Repository structure

```
skills/<id>/            Agent-Skills-compliant skill definitions (SKILL.md + references/)
                        — 11 skills as capabilities of ONE central Manager.
src/
  app/
    (workspace)/        dashboard · manager · priorities · approvals · activity · research · product · leads · marketing · reports · operations
    api/
      health/           configuration + integration status
      manager/          tasks, resume, skills, approvals
      workspace/        clients, overview
    login/
  components/           layout shell and UI primitives
  features/             manager workspace, client forms
  server/
    manager/            orchestrator, planner, understand, execution engine,
                        verifier, approval policy, tool + skill registry, audit
    tools/              registered tool implementations (CRM, leads, research,
                        product, content, email, social, quality, reporting, system)
    integrations/       email provider and social platform adapters
    auth/               actor resolution, authorization records, permission guard,
                        owner provisioning plan
  skills/<id>/skill.json    11 runtime skill definitions imported by the registry
  knowledge/            claim policy, medical safety, research standards,
                        product framework, quality rubric, brand voice, README
  config/               permissions.json, approval-policy.json
  types/                domain and Manager types
supabase/migrations/    0001 identity · 0002 modules · 0003 manager · 0004 RLS · 0005 RLS hardening · 0006 CRM Phase 5 · 0007 media storage
supabase/scripts/       provision_owner.sql — operator-only owner bootstrap (never auto-applied)
                        diagnose_schema.sql  — read-only schema/drift preflight for the SQL editor
scripts/                provision-owner CLI (diagnose → plan → apply → verify)
tests/                  unit + integration suites
docs/                   V2 spec, architecture, phase audit, Supabase verification runbook
```

---

## Using the Manager

Open **CEO / Manager** and hand it an objective, for example:

- `Research the market for dental scheduling software`
- `Research dental implant aftercare protocols`
- `Build a product: a treatment-planning template pack for clinics`
- `Create a LinkedIn post and publish it to our account`
- `Prepare and send a follow-up email to clinic@example.com`

The response shows the classification, the plan and skill selection, per-step
execution results, pending approvals, deliverables with labelled claims and
uncertainty, quality-control findings, the next best action, and the full
reasoning trace.

### API

```bash
# Hand a request to the Manager
curl -X POST http://localhost:3000/api/manager/tasks \
  -H 'Content-Type: application/json' \
  -d '{"request": "Research the market for dental scheduling software"}'

# List pending approvals
curl http://localhost:3000/api/manager/approvals

# Decide an approval (owner/admin only)
curl -X POST http://localhost:3000/api/manager/approvals/<id>/decision \
  -H 'Content-Type: application/json' -d '{"decision":"approved"}'

# Resume the task after the decision
curl -X POST http://localhost:3000/api/manager/tasks/<taskId>/resume
```

---

## What is implemented, and what is not

**Implemented and covered by repository tests:** the full Manager pipeline, 11 skills,
31 registered tools, permission guard, approval lifecycle, verifier, quality
rubric, medical safety screening, audit logging, tenant-scoped schema with RLS,
and the CEO cockpit/Manager workspace UI. Remote Supabase Auth and RLS still
require the live-project verification runbook in `docs/SUPABASE_VERIFICATION.md`
before the deployment can be described as production-ready.

**Deliberately reported as unavailable rather than simulated:**

- Social publishing, scheduling and inbox sync — no official platform
  integration is verified yet, so adapters report `unsupported` (PDF #09 §19).
- Email delivery — reports `not_configured` until a provider is set up.
- AI phrasing — reports `aiEnabled: false` without a provider key.

See `docs/ARCHITECTURE.md` §6 for the adapter contracts.
