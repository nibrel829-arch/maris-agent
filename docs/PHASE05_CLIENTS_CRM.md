# Phase 5 — Clients / CRM (change notes)

Implemented against **PDF #12 Final LLM Arena Master Build Specification v1.0**
(§2 Clients/CRM, §7 CRM scope, §14–§17) without restarting the project: the
existing Supabase Auth, organization membership, permission guard, repository
abstraction, RLS model and dashboard shell are reused unchanged.

## What was built

- **Client directory** (`/clients`): name, company, contact (email + phone),
  status, last activity, created date, actions. Server-side search (name /
  company / email / phone), status filter and pagination (20/page), with
  loading (route `loading.tsx`), empty (blank + no-match), error and in-app
  not-found states.
- **Create client**: full form (name, company, email, phone, status, notes,
  tags) with field-level errors, server-side Zod validation, and success /
  error UI. `organization_id` is never accepted from the browser — the
  service takes tenancy from the session actor.
- **Client detail** (`/clients/[id]`): information, contact, status, tags,
  notes, created/updated timestamps, activity timeline, add-note form, edit
  form, and explicit placeholders where Phases 6–12 attach (social accounts,
  conversations, email history, sequences, content, AI activity). Nothing is
  fabricated: placeholders are labelled with their future phase.
- **Activity foundation**: `client_activity` (existing table) records
  `lead_created` on create, `status_change` on status change, a summary `note`
  on other updates, and manual `note` entries. The `kind` column is free text,
  so email sends, conversations, social interactions, automation events and AI
  actions attach without a schema change. Important actions also write
  append-only `activity_logs` entries (`client.created`, `client.updated`).
- **Service layer** (`src/server/clients/service.ts`): `listClients`,
  `createClient`, `getClientDetail`, `updateClient`, `addClientNote` — each
  following authenticate → authorize (permission guard + org scope) →
  validate → database → log → response. API routes and the Manager tools
  share the Zod schemas in `src/server/clients/validation.ts`.

## Database

- **Migration `0006_clients_crm.sql`** (additive, re-runnable, verified by
  `npm run verify:schema`): nullable `clients.phone`, new `client_status`
  values `prospect` / `inactive` / `completed`, and `client_activity_org_idx`.
  Pre-existing statuses (`lead`, `qualified`, `active`, `paused`, `churned`)
  are preserved — no data migration, no broken rows.
- **RLS unchanged** (0004 tenant policies + 0005 immutability trigger already
  cover `clients` / `client_activity`; 0006 adds no table or policy).
  Proven at the SQL level against embedded PostgreSQL: cross-org read/update/
  insert blocked, tenant move blocked by trigger, anonymous blocked, member
  reads but cannot delete, owner can delete.
- **Live project action required**: apply `0006_clients_crm.sql` (via
  `supabase db push` or the regenerated `npm run db:sql` bundle), then
  re-run `supabase/scripts/diagnose_schema.sql` — Grid 1 now also checks
  `public.clients.phone`.

## API routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/workspace/clients` | GET (`search`, `status`, `limit`, `offset`), POST | Directory + create |
| `/api/workspace/clients/[id]` | GET, PATCH, PUT | Detail + update |
| `/api/workspace/clients/[id]/notes` | POST | Timeline note |

Auth failures → 401/503 without data; permission failures → 403; unknown or
foreign ids → 404 (existence never leaked); invalid input → 400 with messages.

## Known bounds / follow-ups (intentionally out of Phase 5 scope)

- Search/filter paginate over a bounded newest-500 window inside the service
  (`CLIENT_LIST_WINDOW`); exact for typical CRM volumes. Database-level
  search (ilike/trigram) is the follow-up when an org outgrows it.
- No DELETE endpoint yet (owner/admin `clients:delete` permission exists in
  the matrix; UI + route are a later hardening item).
- Live-Supabase smoke test (real session against the attached project with
  0006 applied) still needs project credentials; local proof is PGlite RLS
  checks + memory-backend HTTP checks.

## Verification (all green)

- `npm run typecheck`, `npm run lint` — clean.
- `npm test` — 21 files / 161 tests pass, including new
  `clients-validation`, `clients-service` and `clients-crm` suites
  (CRUD, authz, tenant isolation, invalid input).
- `npm run verify:schema` — 0001→0006 apply, bootstrap idempotent,
  single-paste bundle re-runnable 3×.
- `npm run build` — succeeds; new routes listed.
- HTTP checks (memory backend + dev identity): logged-out page/API expose no
  data; create ignores hostile `organization_id`; search/filter/pagination,
  detail timeline, PATCH/PUT, notes, 400/404 paths, and dashboard/login
  regression all verified against the running server.

## Next recommended task

**Phase 6 — Content Library** (PDF #12 §20): `media_files` + `content_items`
already exist with RLS; build the library UI, upload flow via Supabase
Storage, and draft lifecycle on the same service/validation pattern.
