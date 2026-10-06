# Nibrexo OS AI — Technical Architecture (CEO / Manager Agent)

Source documents: the 12-document Nibrexo OS AI specification set (v1.0) plus
`docs/CEO_MANAGER_AGENT_V2_SPEC.md` (V2 Manager layer).

---

## 1. Layers

```
FRONTEND UI (Next.js App Router, React, Tailwind)
   ↓
API / ROUTE LAYER (src/app/api/**) — authenticate, authorize, validate
   ↓
AUTHORIZATION (src/server/auth/permissions.ts) — role × module × action
   ↓
BUSINESS SERVICES + SKILLS (src/server/tools/**, src/skills/**)
   ↓
AI ORCHESTRATOR / TOOL ENGINE (src/server/manager/**)
   ↓
SUPABASE DATA LAYER + EXTERNAL ADAPTERS (src/server/db/**, src/server/integrations/**)
   ↓
AUDIT / LOGGING (activity_logs, ai_actions)
```

## 2. Manager orchestration layer

| Component | File | Responsibility |
|---|---|---|
| Orchestrator | `server/manager/orchestrator.ts` | Owns the whole lifecycle; the only entry point |
| Understand / Classify | `server/manager/understand.ts` | Parse objective, entities, gaps; classify work type |
| Planner | `server/manager/planner.ts` | Build the plan and select skills |
| Agent Skills (spec) | `skills/*/SKILL.md` | Authoritative external skill definitions with YAML frontmatter (Phase 02) |
| Skill references | `skills/*/references/*.md` | Supporting material per skill (dental safety, outreach rules, etc.) |
| Skill registry (runtime) | `server/manager/skill-registry.ts` | Loads `src/skills/*/skill.json`, validates, exposes to the orchestrator |
| Tool registry | `server/manager/tool-registry.ts` | Explicit schemas and permissions |
| Input resolver | `server/manager/input-resolver.ts` | Chain step outputs into later step inputs |
| Approval policy | `server/manager/approval-policy.ts` | Risk → approval decision |
| Execution engine | `server/manager/execution-engine.ts` | Guard → approve → validate → execute |
| Verifier | `server/manager/verifier.ts` | Confirm results are real and substantive |
| Audit logger | `server/manager/audit.ts` | Record every important action |

Only `runManagerTask` and `resumeManagerTask` start work. No skill, tool or
adapter can self-initiate. The 11 directories under `skills/` are
capabilities of the ONE Manager; they are not 11 autonomous agents.

## 3. Decision log — conflicts and resolutions

| # | Conflict | Resolution |
|---|---|---|
| 1 | PDF #08 §16 defines 8 task states; V2 defines a 9-stage reasoning pipeline | Persist PDF #08 states as authoritative status; record V2 stages in the task trace. See §2 of the V2 spec. |
| 2 | V2 lists 11 skills; PDF #08 §6 lists 6 initial tool groups | Skills are a capability layer *above* tools. Skill JSON declares which registered tools it may use; `validateRegistry()` enforces it. |
| 3 | PDF #02 §4 recommends a separate `backend/` tree; PDF #12 §6 recommends `server/` | PDF #12 is the final handoff document and newer → `src/server/**`. Single Next.js application, no separate backend service. |
| 4 | Dental signals vs business function in classification | Domain and business function are decided separately. Clinical research in a medical domain → `dental_research`; commercial work mentioning dentistry keeps its business work type and still gets medical safety controls. |
| 5 | Autonomy vs. approval | Everything internal is autonomous; everything external, irreversible or high impact stops for explicit approval. |
| 6 | "no fake integrations" vs. wanting a working app | Adapters report `not_configured` / `unsupported` as structured results. Nothing is simulated. |
| 7 | Local development without Supabase | In-memory repository, only selectable when `NODE_ENV !== production`. Refused in production so real data can never be silently discarded. |

## 4. Data layer

`NibrexoRepository` (`src/server/db/types.ts`) is the persistence contract.

- `createSupabaseRepository(client)` — bound to the caller's session so RLS applies.
- `createMemoryRepository()` — local dev and tests only.

Every collection is tenant-scoped: `organization_id` is part of every read,
write and update. Migrations live in `supabase/migrations/`:

| Migration | Contents |
|---|---|
| `0001_core_identity.sql` | organizations, profiles, memberships, activity_logs, notifications, settings, RLS helper functions |
| `0002_modules.sql` | clients, client_activity, leads, media_files, content_items, scheduled_jobs, social accounts/credentials, conversations, messages, email tables |
| `0003_manager_agent.sql` | ai_tasks, ai_actions, ai_memory, approvals, research_briefs, product_concepts, visual_concepts, campaign_plans, social_plans, community_plans, quality_reports |
| `0004_rls_policies.sql` | RLS on every tenant table; destructive writes restricted to owner/admin |

## 5. Security model

- Supabase Auth provides identity; the backend verifies the session and loads
  role and organization membership.
- Authentication is not authorization: `checkPermission()` runs before every
  tool execution and is authoritative.
- RLS is the database boundary underneath the server check.
- Cross-organization access is denied even for owners.
- Secret values are never returned by `get_settings` or any API.
- Privileged keys are read only inside `serverEnv()`.

## 6. External integrations

Both adapters follow the same contract and never fabricate a result.

- **Email** (`server/integrations/email/provider.ts`): `send()` returns
  `sent | not_configured | failed`. Provider-specific code is isolated behind
  the `EmailProvider` interface. Idempotency keys prevent duplicate sends.
- **Social** (`server/integrations/social/adapter.ts`): each platform exposes a
  capability map. Until an official API integration is verified, capabilities
  are `false` and calls return `unsupported` (PDF #09 §19).

## 7. Environment

See `.env.example`. Rules:

- No secret is committed; `.env*` is gitignored.
- `OPENAI_API_KEY` absent → the Manager uses the deterministic planner and
  records `aiEnabled: false`. It never emulates a model response.
- `NIBREXO_DATA_BACKEND=memory` is refused in production.
- `NIBREXO_DEV_AUTH=1` is refused in production and flags the identity as
  `isDevIdentity: true`.
