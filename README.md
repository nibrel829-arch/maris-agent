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
   The current migration set is `0001` through `0005`; `0005` hardens RLS policies after the original four migrations.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (current Supabase/Vercel integration) or `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy).
4. For server-side jobs only, set `SUPABASE_SECRET_KEY` (current) or `SUPABASE_SERVICE_ROLE_KEY` (legacy); both remain server-only secrets.
5. Create a profile and membership row for your user.

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
    auth/               actor resolution and permission guard
    db/                 repository contract, Supabase + memory implementations
  skills/<id>/skill.json    11 runtime skill definitions imported by the registry
  knowledge/            claim policy, medical safety, research standards,
                        product framework, quality rubric, brand voice, README
  config/               permissions.json, approval-policy.json
  types/                domain and Manager types
supabase/migrations/    0001 identity · 0002 modules · 0003 manager · 0004 RLS · 0005 RLS hardening
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
