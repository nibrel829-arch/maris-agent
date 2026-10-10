# Phase 17 — Manager execution and deliverables

## Problem found by audit

Requests such as market research, product concepts, outreach plans and content campaigns ended as short text, status labels, or a false `COMPLETED`.

Root causes, with the evidence that confirmed each one:

1. **Tool failures reported as success.** Tools such as `send_email` and the publish tools return `status: 'not_configured'` or `'failed'` as data, not as thrown errors. The old engine treated any returned value as success. Fixed by `interpretToolOutput` in `execution-engine.ts`.
2. **Empty output counted as verified.** `list_social_accounts` returns `[]` when no account is connected. The old verifier treated an empty array as "no output", so the LinkedIn draft failed for the wrong reason. The verifier now counts an empty top-level array as substantive, and the failure reason comes from the first failed check.
3. **Skipped steps counted as passing.** The original verifier counted skipped steps as passing. Final state was derived only from approvals and `haltedOnError`, ignoring `verification.ok`, skipped, denied and retryable failures. Replaced by the pure `deriveOutcome` in `outcome.ts`.
4. **Placeholders executed.** `create_product_concept` ran with a placeholder `targetCustomer`. Placeholders are now clarifications, not inputs. Marketing `audience`, social `cadence` (labelled as a proposal) and decision-memo facts follow the same rule.
5. **Wrong work type.** "Do market research … and write a report" scored `content`, because `write`, `research` and `report` tied at weight 2 and the first rule won. The output was a content draft with the request as its body, marked `COMPLETED`. Fixed with phrase bonuses (`market research`, `write a report`, …). Covered by `tests/unit/classify-regression.test.ts`.

## Pipeline now

input → `understand` → `classify` (phrase-aware) → `buildPlan(intent, understood, answers)` → tool selection → execute (`interpretToolOutput`) → verify (`verifier.ts`, strict `ok`) → `deriveOutcome` → artifacts (`deliverables.ts` spec → `src/server/artifacts/*` → `manager_artifacts`) → DB (every step persisted with status, inputs, outputs, errors, timestamps) → UI (`ManagerWorkspace.tsx`).

States: `QUEUED`, `RUNNING`, `NEEDS_INPUT`, `BLOCKED`, `WAITING_APPROVAL` (shown as **Awaiting approval**), `COMPLETED`, `FAILED`. Labels and tones come from `src/features/manager/status.ts`, the single source for the UI and `RecentTasks`.

Rules:
- Missing input → `NEEDS_INPUT` with a named field. Never `COMPLETED`.
- Resume (`POST /api/manager/tasks/{id}/resume`) accepts `answers` (≤ 10 fields). The answered field is merged into the plan. Completed tasks refuse resume (409). An answer for a field the Manager did not ask is rejected.
- A step that cannot be verified, or a tool that reports `not_configured` or `failed`, puts the task in `FAILED` or `BLOCKED` with an actionable reason. It is never reported as success.
- Approval-gated actions stop at `WAITING_APPROVAL` and run exactly once after approval (`approval-flow.test.ts`).

## Deliverables

Generated from real execution output only. A deliverable with no real content is omitted.

| Kind | Format | Source tool output |
|---|---|---|
| `research_brief` | DOCX | `create_research_brief` + `add_research_evidence` (`{brief}`, `{recorded, unverifiedCount}`) |
| `product_concept` | DOCX | `create_product_concept` (`{concept}`) |
| `business_report` | DOCX | `build_business_report` (`{report, missingData}`) |
| `campaign_plan` | DOCX | `create_campaign_plan` (`{campaignPlan}`) |
| `social_plan` / `community_plan` | DOCX | `create_social_plan`, `create_community_plan` |
| `outreach_draft` | DOCX | `create_email_template`, `prepare_email` (status `DRAFT`) |
| `decision_memo` | DOCX | `create_decision_memo` (`{memo}`) |
| leads / evidence tables | CSV | lead and evidence rows |

Captions from `generate_caption` without a provider key are labelled as unreviewed skeleton copy.

Storage: `manager_artifacts` (migration `0013`), base64 `content_base64` (≤ 10 MiB), `sha256`, `size_bytes`, `organization_id`, `task_id`, `step_id`, `kind`, `format`, `title`, `file_name`, `mime_type`, timestamps. RLS: members select and insert, admins delete, no update.

Download: `GET /api/manager/artifacts/{artifactId}` requires `ai:create`. It returns the bytes as an attachment with `Content-Disposition`, `X-Artifact-SHA256`, `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store`. Stored bytes are re-hashed before serving; a mismatch returns `INTEGRITY_FAILED`. Cross-org requests return 404, client-role requests return 403.

Endpoints:
- `GET /api/manager/tasks/{id}/deliverables` (`ai:view`)
- `GET /api/manager/deliverables` (`ai:view`, organization-wide)
- `GET /api/manager/approvals` (`ai:view`); the decision route keeps the `settings` edit gate.

PDF and XLSX are not produced in this phase. The dependency-free layer in `src/server/artifacts/` writes DOCX (minimal OOXML) and CSV, and zip is used internally by DOCX. Adding PDF or XLSX needs a dependency or a new writer and is left as follow-up work.

## Supabase: migration 0013

File: `supabase/migrations/0013_manager_execution.sql`. It is additive and does not change existing rows:

- `alter type … add value if not exists` for `NEEDS_INPUT` and `BLOCKED`.
- `create table manager_artifacts` with RLS policies and the tenant-identity trigger.

To apply, paste the file in the Supabase SQL Editor, or run `npm run db:sql` and paste its output. `ADD VALUE` cannot be used inside the same transaction as a later statement that uses the new value; the migration does not do that.

## Verification (this session)

- `npx vitest run`: **44 files, 441 tests passed**.
- `npx tsc --noEmit`: exit 0.
- `npx eslint .`: exit 0.
- `npm run build`: exit 0.
- `node scripts/verify-schema-pglite.mjs`: passed on embedded PostgreSQL, migrations 0001–0013 applied in order, idempotent re-run. The schema verifier's migration list now includes `0013`.
- Real API run (memory backend, dev auth, `next dev`):
  - Request "Do market research on the dental clinic software market in Lahore, Pakistan and write a report" → `NEEDS_INPUT`, asks for sources.
  - Resume with two sourced claims → `COMPLETED` with one `research_brief` DOCX (8,841 bytes).
  - Download → HTTP 200, `attachment`, `private, no-store`, `X-Artifact-SHA256` equal to the SHA-256 of the downloaded bytes, valid DOCX package, evidence table contains the supplied claims.
  - Note: the two source lines in that run were written by me as a test fixture, not real research. The run lived only in the in-memory dev store.

Browser check: not performed. The sandbox has no interactive browser. `/manager` returns 200 and the production build compiles the rewritten page. Interactive checks of the question form, retry buttons and download links remain to be done by a person.

## Remaining limits

- `qualify_lead` needs a real CRM lead UUID and scored criteria. Text answers cannot supply them, so this path is documented as not resumable.
- Source grading is taken from the user's claims. A source saying "not independently verified" still records as evidence at 0.60. The Manager does not second-guess the user's sources.
- Sending email, publishing, and any external action still require approval and a configured provider. None were executed in this work.
- PDF and XLSX deliverables are not implemented.
- Vercel: the connector is unavailable and the sandbox cannot reach the production URL. The PR #9 Vercel check passed for head `1eb02da`. The deployed URL for this latest commit has not been checked.
