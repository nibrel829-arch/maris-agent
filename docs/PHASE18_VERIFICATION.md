# Phase 18 — Merge verification, production security and Manager E2E

**Branch:** `arena/0b73977b-maris-agent` (fixed for this session; no other branch created).
**Base:** `main` at `1bd90b4`. **PR:** #9 (targets `main`, **not merged**; see §1).

Legend: **[V]** verified by an executed command or a recorded remote result · **[L]** verified only in a local/sandbox run, not in production · **[B]** blocker or not verifiable from this environment · **[M]** manual step for the operator.

---

## 1. Git and PR state

| Item | Finding | Status |
|---|---|---|
| Local checkout | Branch ref was at `1bd90b4` (`main`) while all Phase 17 work sat uncommitted in the working tree. Working tree was byte-identical to `origin/arena/0b73977b-maris-agent` at `66e4f6f`. | **[V]** Fixed by moving the local branch ref to `66e4f6f` (`git reset --mixed`). No file content was changed or discarded. |
| `main` | `1bd90b4`, unchanged. | **[V]** |
| PR #9 at start | Head `66e4f6f`, state OPEN, `mergeStateStatus: CLEAN`. Checks: `Typecheck, lint and test` pass, `Vercel` pass, `Vercel Preview Comments` pass. | **[V]** |
| Security issues remaining in PR #9 | Yes: the recipient asset route could not load bytes in production (§3.1, B1) and the social OAuth redirect accepted `http://` in production (§3.1, B2). | **[V]** |
| Merge decision | **Not merged.** The rule in this phase is to fix and update the PR when a security issue remains. The Phase 18 fixes are on the same branch. Merging the updated PR is left for an explicit instruction. | See §9 |

## 2. Production configuration

### 2.1 What can and cannot be inspected

- The **Vercel connector is unsupported** in this environment (`list_connector_tools` → `unsupported`). Vercel project environment variables **could not be read**. No Vercel setting was changed.
- The sandbox **cannot reach `*.vercel.app`** (curl exit 35), so the deployed URLs could not be probed.
- GitHub deployment records were readable (see §8).
- GitHub secret names could not be listed (`gh secret list` failed with no output). Nothing secret was printed.

### 2.2 Production behaviour checked locally (`next start`, `NODE_ENV=production`, no secrets, no dev auth, no Supabase) [L]

| Check | Result |
|---|---|
| `GET /api/health` | `emailAssetSigning: none`, `appUrl: unset`, `supabase: false`. No secret material. |
| Asset link signed with the old public-URL-derived key | **403** `ASSET_TOKEN_INVALID` — signing fails closed. |
| `GET /api/workspace/content/media/{id}/file` without a session | **503** (no dev identity in production). |
| `GET /api/manager/tasks` without a session | **503**. |
| `GET /api/cron/publish` without bearer | **401** `CRON_UNAUTHORIZED`. |

With `NIBREXO_EMAIL_ASSET_SECRET=<test value>` and `NIBREXO_APP_URL=http://os.nibrexo.test`:

| Check | Result |
|---|---|
| `emailAssetSigning` | `NIBREXO_EMAIL_ASSET_SECRET` (source name only). |
| `appUrl` | `invalid` (http is refused in production). |
| Secret value appears in the health body | **No.** |

The test secret was used only in the process environment and was not written to the repository.

### 2.3 Asset-signing requirements (checked by tests and by the live probe in §3.2)

| Requirement | Evidence |
|---|---|
| Fails closed in production with no secure key | `tests/unit/email-asset-hardening.test.ts` ("refuses to mint a link…", "refuses every request…") and the production run above. |
| Tampered signature rejected | live probe: flipped signature → 403. |
| Expired link rejected | live probe: correctly signed but expired → 403. |
| Cross-organization access rejected | live probe: valid signature for another org → 404 (no row); org swapped with old signature → 403. |
| Private assets do not expose storage paths | live probe: no storage path in response headers or body; 404 body contains no org path. |
| Public Supabase URL never used as key material | unit test "never derives a signing key from the public Supabase URL". |
| Production URLs use the intended HTTPS origin | `configuredAppOrigin` requires https in production; OAuth redirect now uses it (§3.1, B2); tests in `tests/unit/app-origin.test.ts`. |
| Email and publishing approval gates | `src/config/approval-policy.json` requires approval for `send_email`, `send_reply`, `send_outreach`, `send_dm`, `publish_post`, `schedule_post`. The planner never adds `publish_post` (planner test). Live run: an outreach send stopped at `WAITING_APPROVAL` and executed only after an explicit approval decision. |

### 2.4 Manual steps the operator must perform in Vercel (not performed here)

Do these in the Vercel dashboard for **Production** and **Preview**. Do not rotate existing secrets without authorization: rotating the signing key invalidates links already sent in email.

1. **Set `NIBREXO_EMAIL_ASSET_SECRET`** to 32+ random bytes (`openssl rand -hex 32`). Redeploy. Confirm `GET /api/health` returns `configuration.emailAssetSigning: "NIBREXO_EMAIL_ASSET_SECRET"`.
2. **Set `NIBREXO_APP_URL=https://<production-domain>`** with no path. Confirm `configuration.appUrl: "valid"`. Without this, links use the request origin, which is also https on Vercel.
3. **Confirm no insecure fallback was ever in use:** check that the Production deployment does not rely only on `NEXT_PUBLIC_SUPABASE_URL`. The old public-URL key was used only when no other key existed; a deployment with neither was forgeable before the Phase 17 fix.
4. Confirm the Supabase service-role key is set in Vercel server-side only (not prefixed `NEXT_PUBLIC_`).
5. Re-run `GET /api/health` on the production URL once Deployment Protection allows access, and record the response.

## 3. Defects found and fixed in this phase

### 3.1 Verified defects

| # | Defect | Impact | Fix | Regression test |
|---|---|---|---|---|
| B1 | The recipient-facing asset route (`/api/workspace/email/assets/[mediaId]`) fetched bytes with the **session-bound** storage client. Mail recipients have no session, so every real email image would return 404. The existing test mocked that function and asserted on it, which hid the defect. | Every production email image would fail to load. | Byte fetch now uses the server-only storage client after the token check and the organization-filtered row read. | `signed asset route > serves a valid token…` now asserts `getJobMediaStorage` is used and `getRequestMediaStorage` is not. New: `returns not found… when the bytes are missing`. |
| B2 | `buildRedirectUri` (social OAuth) used `NIBREXO_APP_URL` unvalidated. An `http://` value in production produced an insecure redirect (readiness item F1). | Insecure OAuth callback in production. | Uses the validated origin helper; production requires https; invalid values fall back to the request origin. Shared helper moved to `src/lib/app-origin.ts` and re-exported from `asset-url.ts`. | `tests/unit/app-origin.test.ts` (8 tests). |
| B3 | `asset-url.ts` lost a local import during the B2 refactor and the build failed on an unused import (caught by `next build`, not by the earlier tests). | Build broken. | Removed the unused import. | Covered by the build gate. |
| B4 | Lead CSV: `status` column was always blank because `create_lead` returns `stage`. | Lead export missing stage. | Writes `stage`. Header is now `name,company,email,source,stage`. | `manager-sourcing.test.ts` (CSV header and content). |
| B5 | Lead CSV: `source` held the entire multi-line research-sources answer (truncated at 200 characters). | Unreadable, misleading lead source. | `leadSourceLabel()` returns one clean label from the first source line. | `research-sourcing.test.ts` (`leadSourceLabel`, planner input). |
| B6 | **Unsourced research completed.** A research request whose only claim had no source ran and finished `COMPLETED`. The DOCX labelled the claim as unverified, but the assignment was still presented as done. | Violates "empty or fabricated research is never presented as verified research". | The planner requires at least one sourced claim (`grade: EVIDENCE`) before research steps run. Otherwise they stay `NEEDS_INPUT` with a question that explains the format. | `research-sourcing.test.ts`; `manager-sourcing.test.ts` ("keeps research in Needs input…"). |
| B7 | **Stuck task.** After B6 was fixed, the sources question stayed in the plan as answered, so the UI showed no form and the task could not finish. | Task unrecoverable from the UI. | `applyAnswers` re-opens a question when the rebuilt plan still raises it, keeping its field and step. | `manager-sourcing.test.ts` ("re-opens the sources question…"). Verified live (§4.3). |

### 3.2 Feature added

- **Artifact preview.** `GET /api/manager/artifacts/{id}/preview` returns a bounded table (CSV, up to 25 rows) or paragraph list (DOCX, up to 80 paragraphs), derived from the stored bytes with the same authorization as the download. The assignment workspace shows a **Preview** button per deliverable with loading, error and retry states. Unsupported formats say so and point to the download.
- Tests: `tests/unit/artifact-preview.test.ts` (8 tests, including DOCX generated by the project writer and entity decoding).

## 4. Manager end-to-end validation

Setup: `next dev` on the memory backend with `NIBREXO_DEV_AUTH=1`, which gives a single owner identity. Live calls used the real HTTP API. Fixture sources are **labelled test data** and are not real research.

### 4.1 Results

| Acceptance criterion | Evidence | Result |
|---|---|---|
| Missing information → `Needs input`, never false `Completed` | Lead request without name → `NEEDS_INPUT`. Research request with no sources → `NEEDS_INPUT`. | **[V] pass** |
| Resume with answers runs the remaining steps | Lead resumed with name + sources → `COMPLETED`; steps `create_research_brief`, `add_research_evidence`, `create_lead`, medical and quality checks all `succeeded`. | **[V] pass** |
| Genuine failure → `Failed` or `Blocked`, actionable | Outreach to a named recipient → `WAITING_APPROVAL` → approved → resumed → `send_email` `failed`, task `BLOCKED`, reason `NOT_CONFIGURED`: "No email provider is configured. Set NIBREXO_EMAIL_PROVIDER and the provider credentials…". No send occurred. | **[V] pass** |
| Completed assignments have verified outputs | Completed runs had a successful verifier and deliverables from real output. Unsourced research no longer completes (B6). | **[V] pass** |
| DOCX and CSV contain actual results, persisted, downloadable | Lead CSV: `name,company,email,source,stage` / `Sindh Smile Dental Clinic,,,"FIXTURE…",identified`. Research DOCX (8,634 bytes) contains the evidence table. Both downloaded with `attachment`, `private, no-store`, and `X-Artifact-SHA256` equal to the SHA-256 of the bytes. | **[V] pass** (memory store) |
| Survives reload | Deliverables re-listed through `GET …/deliverables` and re-downloaded in later requests. | **[L] within one process only.** Memory backend is lost on restart. Supabase persistence not tested (no credentials). |
| Unauthorized users and other organizations cannot access artifacts | Integration tests: cross-org download 404, client role 403, tampered bytes `INTEGRITY_FAILED`. Preview reuses the same authorization function. Live check: unknown id 404, malformed id 400. | **[V] tests**; live multi-user check not possible (dev identity is owner-only). |
| Empty or fabricated research is never presented as verified | B6 and B7 fixed; unsourced claims are labelled `INTERPRETATION` with confidence 0.30. | **[V] pass** |
| Existing approval gates effective | Live outreach run (above). Test suites `approval-flow` and `approval-policy` pass. | **[V] pass** |

### 4.2 Classification

"Do market research … and write a report" was classified as `research` (fixed in Phase 17). Regression: `tests/unit/classify-regression.test.ts`.

### 4.3 Live API evidence (dev server, memory backend)

- Unsourced research answer → `NEEDS_INPUT`, open field `sources`, reason "Each claim needs a source…".
- Sourced answer → `COMPLETED`, one `docx` deliverable.
- Preview of the DOCX: text decoded correctly, including `&` and quotes from the source line.
- Preview of the CSV: one row with `source` "FIXTURE source (test data, not real research)" and `stage` "identified".

### 4.4 Signed-link probes (dev server with a test-only secret)

| Probe | Result |
|---|---|
| Valid signature | 200, bytes equal the uploaded PNG, `Content-Disposition: inline; filename="brand-logo.png"` (original file name only), `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: cross-origin`, `Cache-Control: private, max-age=…` |
| Tampered signature | 403 |
| Signature for a different expiry | 403 |
| Correctly signed but expired | 403 |
| Valid signature for another org | 404 |
| Org swapped, old signature | 403 |
| Malformed org | 400 |
| Missing signature | 403 |
| Non-canonical expiry (`0…`) | 403 |
| Unknown media id, valid signature | 404 |

Storage paths were not present in headers or bodies.

**Note:** in dev mode (`NIBREXO_DEV_AUTH=1`) the session media route serves the dev owner without a session. That is intended for local development and is refused in production (§2.2).

## 5. Quality gates

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | **0** | `tsc --noEmit` clean |
| `npm run lint` | **0** | `eslint .` clean |
| `npm test` | **0** | **48 files, 469 tests passed** |
| `npm run verify:schema` | **0** | Migrations 0001–0013 applied to embedded PostgreSQL; diagnose reports all 20 objects; owner bootstrap and RLS checks pass; single-paste output: 43 tables, 14 enums, 161 policies; re-runnable 3×. Installed with `npm i --no-save @electric-sql/pglite@0.2.17`; `package.json` and lockfile unchanged. |
| `npm run build` | **0** | Production build succeeds, including `/api/manager/artifacts/[artifactId]/preview`. |

Start of this phase: 441 tests (Phase 17 baseline). End: 469 tests.

## 6. Limits and not verified

- **Deployed production behaviour:** not verified. The Vercel connector is unsupported, Deployment Protection blocks access, and the sandbox cannot reach `vercel.app`.
- **Browser behaviour of the workspace:** not verified. No interactive browser is available. The Preview button, question form and retry buttons were compiled and checked through their API, not by clicking.
- **Supabase persistence and RLS against the live project:** not verified. Embedded PostgreSQL only.
- **Real email delivery:** not verified. No provider is configured; nothing was sent.
- **Real research:** none was performed. Every source in the tests and live runs is labelled fixture data.
- **Source grading:** a source the user supplies is recorded as evidence even if its text says "not independently verified". The Manager trusts the user's sources.
- **Asset link lifetime:** tokens last 30 days by default. A leaked email grants access to that asset until expiry.
- **Test-send bypasses the approval queue** (permission-gated, human-initiated). This is a product decision (readiness F3).
- **UI publish** is permission-gated (`social:publish`) and human-initiated. Manager-initiated publishing is approval-gated.
- **Vercel-generated origin:** when `NIBREXO_APP_URL` is unset, asset links use the request origin. The `x-forwarded-host` header is trusted for that fallback, which is acceptable on Vercel but should be replaced by `NIBREXO_APP_URL` in production (§2.4).
- **PDF and XLSX** are not implemented. DOCX and CSV only.
- **`qualify_lead`** requires a real CRM lead id and is not resumable from text answers.

## 7. Schema

No new migration was added in this phase. Migration `0013_manager_execution.sql` from Phase 17 is additive and was verified on embedded PostgreSQL. Apply it in Supabase only if it has not already been applied; see `docs/PHASE17_MANAGER_EXECUTION.md`.

## 8. Deployment evidence (GitHub deployment records)

| Deployment | Environment | Commit | Created (UTC) | State | URL |
|---|---|---|---|---|---|
| 6978168151 | **Production** | `1bd90b4` (= `main`) | 2026-10-10 08:13:15 | success | https://maris-agent-7hmfsfwaz-comuno.vercel.app |
| 6978273508 | Preview | `1eb02da` | 2026-10-10 08:24:31 | success | https://maris-agent-9dzrbtobh-comuno.vercel.app |
| 6978501162 | Preview | `66e4f6f` | 2026-10-10 08:48:24 | success | https://maris-agent-5ojme6de9-comuno.vercel.app |

- **No production deployment exists for any commit after `1bd90b4`.** Production is still running `main` as of the last record. Phase 17 and Phase 18 changes are not in production until PR #9 is merged and the Production deployment completes.
- The URL that serves the latest commit cannot be confirmed from here. The Vercel check on the latest PR head is the best available evidence.

## 9. PR status and next action

- **PR #9:** open, targets `main`, not merged. Head updated by this phase's commit (see §10).
- **Next action (operator):** review this document and the PR diff, complete the Vercel steps in §2.4, then confirm the GitHub checks are green on the new head. After that, merge PR #9 with `gh pr merge 9 --merge` on your instruction. Then confirm the Production deployment for the merge commit and run the §2.2 checks against the production URL.

## 10. Commits

See the PR and `git log` for the final hashes. This phase's commit message: "Phase 18: production security fixes, Manager E2E verification, artifact preview".
