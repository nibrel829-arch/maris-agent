# Phase 17 — Production Readiness & Deployment Verification

**Base:** `main` at merge commit `1bd90b497419595e95f4c8078aa4201382e930c1` (Phase 16 merged via PR #8; Phase 16 commit `2a5585d`).
**Session branch:** `arena/0b73977b-maris-agent` (the Phase 17 commit and PR live on this branch; see §8 for why no separate branch was created).
**Scope rule:** verify first, fix only verified defects, do not send email, do not change production data or configuration.

Legend: **[V]** verified by an executed command or a recorded remote result · **[A]** assumption, not verified · **[B]** blocker.

---

## 1. Repository state at start [V]

| Check | Result |
| --- | --- |
| `git status` | Clean working tree on `arena/0b73977b-maris-agent`, HEAD `1bd90b4` (equal to `main`). |
| Preserved QA samples `SAMPLE-EMAIL.html` / `SAMPLE-EMAIL.txt` | **Not present** anywhere in the repository (`find . -name "SAMPLE-EMAIL*"` returned nothing). Nothing was discarded. |
| Phase 16 documentation | `docs/PHASE16_EMAIL_STUDIO.md` present and read. Phase 16 test baseline: 39 files / 369 tests. |

## 2. Deployment and CI evidence

### 2.1 GitHub Actions [V]

Queried with `gh run list` / `gh run view` (authenticated as `nibrel829-arch`).

| Run | Event / branch | Result |
| --- | --- | --- |
| 38037043586 — "Merge pull request #8" | push / `main` | **success** (head `1bd90b4`). Steps: install, typecheck, lint, unit+integration tests, production build — all `success`. |
| 38036769629 / 38036430012 | pull_request / Phase 16 branch | success |

### 2.2 Vercel deployment [V for GitHub-recorded status; B for live verification]

- The Vercel connector is **not available** in this environment (`list_connector_tools` → `unsupported`), so the Vercel dashboard and environment variables could not be inspected.
- GitHub deployment records (`gh api repos/…/deployments`) show a **Production** deployment for `1bd90b4` (created 2026-10-10T08:13:15Z) with state **success**, URL `https://maris-agent-7hmfsfwaz-comuno.vercel.app`. Commit status `Vercel` on `1bd90b4` is `success`.
- **The production URL is behind Vercel Deployment Protection (SSO login).** Both `fetch_page` and direct HTTP returned the Vercel login page, and direct HTTP from the sandbox cannot reach `vercel.app` at all (outbound access is limited to GitHub and package registries). Therefore **no runtime behaviour of the live deployment was observed**. Live `/api/health`, authentication, org isolation and asset-route checks against Vercel remain **unverified [B]**.

## 3. Audit: `NIBREXO_EMAIL_ASSET_SECRET`, `NIBREXO_APP_URL`

### 3.1 Defect found and reproduced [V] — forgeable asset links without a configured secret (HIGH)

Before the fix, `assetSigningSecret()` fell back, after the explicit variables, to `nibrexo-email-assets:origin:${NEXT_PUBLIC_SUPABASE_URL}`. `NEXT_PUBLIC_SUPABASE_URL` is shipped in the browser bundle, so the HMAC key was public. Reproduced with a probe script (`NODE_ENV=production`):

```
A) nothing set:                       durable=false  verifiesOwnToken=true
B) only NEXT_PUBLIC_SUPABASE_URL set: durable=false  verifiesOwnToken=true   <- key derived from a public value
C) public URL + anon key, no service: durable=false  verifiesOwnToken=true   <- same
D) explicit secret:                   durable=true   verifiesOwnToken=true
```

Impact: anyone who can read the public URL can mint a valid `exp`/`sig` for any `mediaId` + `org` pair. Media ids and org ids are present in every rendered email, and the route serves the file. This is a cross-tenant private-asset exposure **whenever the service-role key and token key are both absent**. Whether production is affected depends on its Vercel environment variables, which could not be inspected **[B]**.

**Fix (commit on this branch):** the public-URL fallback is removed. The key chain is now `NIBREXO_EMAIL_ASSET_SECRET` → `NIBREXO_TOKEN_ENCRYPTION_KEY` → `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY` (server-only). Outside production a per-process ephemeral key is used. **In production with no durable key the system fails closed**: no links are minted (the block renders its colour placeholder), and any presented token returns 403.

### 3.2 Other findings and fixes

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Public-URL-derived key (§3.1). | High | **Fixed** + regression tests. |
| 2 | Production without a key silently used an ephemeral per-process key, so instances disagreed (intermittent broken images). | Medium | **Fixed**: production fails closed instead. |
| 3 | `exp` parsed with `parseInt`, so `0<exp>`, `+<exp>` and `<exp>abc` produced alternative encodings of a valid token. | Low | **Fixed**: canonical decimal only (`^(0|[1-9]\d{0,11})$`). Regression tests. |
| 4 | Asset route accepted any `org` string before verification. | Low | **Fixed**: UUID shape required (400). |
| 5 | Asset and Content Library byte responses served uploaded `image/svg+xml` inline on the app origin with no CSP. A script in an SVG would run on the app origin. The public-token asset route is reachable by a mail recipient without a session. | Medium–High | **Fixed**: `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `nosniff`, and `Cross-Origin-Resource-Policy: cross-origin` on both routes (`src/server/content/media-headers.ts`). `<img>` rendering is unaffected. |
| 6 | `NIBREXO_APP_URL` used raw (no scheme or credential check). A value such as `http://…` in production would produce insecure asset links. | Medium | **Fixed for email asset links**: valid https origin only (http allowed outside production), no credentials, path dropped. Invalid values fall back to the request origin and are reported by `/api/health`. |
| 7 | `emailAssetRouteReady()` had no callers and checked the public URL. | Low | **Removed**. |
| 8 | `.env.example` said `NIBREXO_DATA_BACKEND=memory` "refuses to start" in production. The code silently selects `supabase`, which then fails closed. | Doc | **Corrected**. |
| 9 | Social OAuth `buildRedirectUri` uses `NIBREXO_APP_URL` unvalidated. An `http://` value in production would produce an insecure OAuth redirect. | Medium | **Not changed** (out of Phase 17 email scope; changing it alters the OAuth contract). Recommended follow-up in §9. |
| 10 | Asset tokens are not bound to the origin they were minted for; the origin is not in the HMAC input. | Info | Accepted: the token is only a capability for one media id in one org; origin does not change what it grants. |
| 11 | Key reuse: `NIBREXO_TOKEN_ENCRYPTION_KEY` and the service-role key also seed the asset HMAC, under a domain prefix. | Info | Accepted with domain prefix; **a dedicated `NIBREXO_EMAIL_ASSET_SECRET` is recommended in production** so rotating the service-role key does not break already-sent emails. |

### 3.3 Diagnostics added [V]

`GET /api/health` → `configuration.emailAssetSigning` (one of `NIBREXO_EMAIL_ASSET_SECRET`, `NIBREXO_TOKEN_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `ephemeral`, `none`) and `configuration.appUrl` (`unset` / `valid` / `invalid`). Names and states only, never key material.

### 3.4 Expiration and multi-instance consistency [V by test]

- TTL default 30 days, clamped to [60 s, 180 d]; expiry checked before signature comparison; signature compared with `timingSafeEqual`.
- Multi-instance: the durable key sources are environment-derived and identical across instances. The ephemeral key is per process and is now **only used outside production**.
- A Phase 16 test asserted that the ephemeral key survives a cache reset. The cache was removed (the key is read on each call so configuration changes take effect), so the test was rewritten to check the actual property: a **re-imported module in the same process returns the same ephemeral key**.

## 4. Verification commands and results

All commands were run from `/home/user/maris-agent` after `npm ci` (exit 0).

| Command | Before fixes | After fixes |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | **exit 0** |
| `npm run lint` | exit 0 | **exit 0** |
| `npm test` | exit 0 — 39 files / 369 tests | **exit 0 — 40 files / 387 tests** (18 new Phase 17 tests; 1 Phase 16 test rewritten, §3.4) |
| `npm run verify:schema` | exit 1 — needs optional `@electric-sql/pglite@0.2.17` (the script's own message) | `npm i --no-save @electric-sql/pglite@0.2.17` (exit 0; `package.json` and lockfile unchanged), then **exit 0**: all 12 migrations applied to embedded Postgres, `diagnose_schema.sql` reports all 20 objects, RLS checks, owner bootstrap, re-runnable SQL emission (42 tables, 14 enums, 158 policies). |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | exit 0 | **exit 0** (`/api/workspace/email/assets/[mediaId]` and `/api/workspace/content/media/[id]/file` built as dynamic routes; no warnings) |

### 4.1 Production-mode server checks [V, local `next start`]

Built app served with `NODE_ENV=production` (`next start`), no Supabase, no secrets set. Results:

| Request | Result |
| --- | --- |
| `GET /api/health` | `environment: production`, `emailAssetSigning: none`, `appUrl: unset`, `dataBackend: supabase`, `supabase: false`. No secret material. |
| Asset URL forged with the old public-URL key | **403 `ASSET_TOKEN_INVALID`** ("signing key not configured") |
| Asset URL with malformed `org=bad` | **400 `INVALID_INPUT`** |
| `GET /api/workspace/email/designs` unauthenticated | **503 `AUTH_NOT_CONFIGURED`** (fails closed; dev identity disabled in production) |
| `GET /api/cron/publish` without bearer | **401 `CRON_UNAUTHORIZED`** |

Second run with `NIBREXO_EMAIL_ASSET_SECRET=<random 64 hex>` and `NIBREXO_APP_URL=http://os.nibrexo.test` (invalid in production):

| Request | Result |
| --- | --- |
| `GET /api/health` | `emailAssetSigning: NIBREXO_EMAIL_ASSET_SECRET`, `appUrl: invalid` |
| Token signed with the configured secret | Passes signature and expiry checks, then **503 `SUPABASE_NOT_CONFIGURED`** (no database in the sandbox, so the byte stage is not reached) |
| Same token with one signature character changed | **403 `ASSET_TOKEN_INVALID`** ("signature mismatch") |

The secret generated for that run was deleted and not written to the repository.

## 5. Authentication, organization isolation and approval gates

| Area | Evidence | Status |
| --- | --- | --- |
| Session-gated APIs refuse unauthenticated calls in production | §4.1 local run; `resolveActor` refuses without Supabase when `NIBREXO_DEV_AUTH` is off in production (`devAuthEnabled = flag && !isProduction`). | **V (local)** |
| Cron endpoint requires its secret | §4.1 (401 without bearer). Existing `publish` tests. | **V (local)** |
| Asset route org isolation | Token bound to `(mediaId, orgId)` by HMAC; route reads `mediaFiles.get(mediaId, organizationId)`; tests for cross-org token and tampering. | **V (unit + route tests)** |
| Email send permission | `sendEmail`, `sendDesignTestEmail` check `email:send`; `renderDesign` `view`; creates `create`; edits `edit`. Existing `email-design-service` and `email-studio-api` suites pass. | **V (existing tests)** |
| Manager `send_email` approval gate | `risk: 'high'`, `external: true`; `config/approval-policy.json` `requireApproval` lists `send_email`; `evaluateApproval` returns `required: true`. Confirmed by reading the policy and tool definition; the existing `approval-policy` / `approval-flow` suites pass but were not checked to assert `send_email` by name. | **V (by reading) + suites pass** |
| UI test-send (`POST /designs/[id]/test-send`) | Gated by `email:send` and blocking validation, **not** by the Manager approval queue. This matches the Phase 16 design (a human clicks "send test"). | **V (by reading)**; behaviour by design, see §7 |
| Opt-out guard | `sendEmail` refuses opted-out recipients (`RECIPIENT_OPTED_OUT`). Confirmed by reading the code; not separately re-tested in Phase 17. | **V (by reading)** |
| Live tenant isolation on Supabase (RLS) | Schema verified on embedded Postgres (authenticated non-member sees 0 orgs; cross-tenant CRM/participant links rejected). Not run against the live project. | **V (embedded PG) / B (live)** |

## 6. Email delivery

- `RESEND_API_KEY`, `NIBREXO_EMAIL_PROVIDER`, `NIBREXO_EMAIL_FROM`: **unset in this sandbox** [V].
- **No email was sent.** No test send, no provider call, no delivery claim. The provider adapter reports `not_configured`.
- Delivery to a real inbox, a verified sender domain, and a rendered-email client matrix remain **unverified [B]**.

## 7. Security considerations

1. **Bearer-style asset links.** The HMAC token is a capability. Anyone with the link can fetch that one file until expiry. 30 days by default; a leaked email grants access to that asset for that period. Mitigation: re-render, or shorten the TTL for sensitive assets.
2. **Recipient-facing route is public by design** (mail clients have no session). It is hardened by: token-first verification, org-filtered DB read, sandbox CSP, `nosniff`, `private` caching, and no storage paths in input.
3. **SVG uploads.** The Content Library accepts `image/svg+xml`. Byte responses are now sandboxed (§3.2 #5). Consider rejecting SVG at upload if it is not needed for email.
4. **Key hygiene.** Use a dedicated `NIBREXO_EMAIL_ASSET_SECRET`, generated with `openssl rand -hex 32`. Do not reuse the service-role key for signing in production.
5. **`/api/health`** is unauthenticated. It reports configuration states and names only; no URLs, keys or user data. The new fields follow the same rule.
6. **Test-send bypasses the approval queue** (permission-gated only). It sends a single labelled `[Test]` email to an address the user chooses. This is intentional for Phase 16 but worth a product decision before go-live.
7. **Dependencies.** No new runtime dependency was added. `@electric-sql/pglite` was installed `--no-save` for verification only.

## 8. Branch and PR note

The request asked for a dedicated `phase17-…` branch. This session is fixed to `arena/0b73977b-maris-agent`, so the Phase 17 commit and the PR are on that branch. No other branch was created or pushed. The PR targets `main` and is **not** merged automatically.

## 9. Remaining blockers and next required actions

| # | Blocker / action | Owner | Priority |
| --- | --- | --- | --- |
| B1 | Confirm the live Vercel production deployment: disable or bypass Deployment Protection for smoke tests (or provide a protection bypass), then run `GET /api/health` and the §4.1 requests against the real URL. | Operator | High |
| B2 | Set `NIBREXO_EMAIL_ASSET_SECRET` (32+ random bytes) in Vercel **Production** and **Preview**. Confirm via `/api/health` that `emailAssetSigning` is `NIBREXO_EMAIL_ASSET_SECRET`. | Operator | **Critical** |
| B3 | Set `NIBREXO_APP_URL=https://<production-domain>` (no path) so asset links use the canonical origin; confirm `appUrl: valid`. | Operator | High |
| B4 | Verify that production never had the public-URL key in effect: check Vercel env for `SUPABASE_SERVICE_ROLE_KEY` / `NIBREXO_TOKEN_ENCRYPTION_KEY`. Before this fix, a deployment with neither would have been forgeable. Rotate asset links if in doubt (rotating the signing key invalidates existing links). | Operator | **Critical** |
| B5 | Provide Resend credentials (`NIBREXO_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `NIBREXO_EMAIL_FROM` on a verified domain) **and explicit authorization** before any test send. Then send one `[Test]` to an approved address and record the provider message id. | User (authorization) | High |
| B6 | Run the Supabase migrations and `npm run verify:schema` against the live project; confirm the 12-migration state (`diagnose_schema.sql`). | Operator | High |
| F1 | Apply the same `NIBREXO_APP_URL` validation to social OAuth `buildRedirectUri` (reject `http://` in production). | Engineering | Medium |
| F2 | Decide whether SVG should be accepted at upload (§7.3). | Product | Medium |
| F3 | Decide whether UI test-send should require approval (§7.6). | Product | Low |
| F4 | Add a real email-client render matrix (Phase 16 §3 blocker, still open). | QA | Medium |

## 10. Summary of this phase

- **Verified:** typecheck, lint, 387 tests (40 files), schema on embedded Postgres (12 migrations), production build; GitHub CI success on `main`; GitHub-recorded Vercel production deployment success for `1bd90b4`; production-mode local server checks for fail-closed auth, token verification and secret-source diagnostics.
- **Fixed:** the public-URL-derived asset key (high), production ephemeral-key inconsistency, non-canonical expiry, org shape validation, sandbox CSP for SVG and other byte responses, `NIBREXO_APP_URL` validation, dead code, and a misleading `.env.example` note.
- **Not verified:** live Vercel behaviour (deployment protection), live Supabase RLS, email delivery (no credentials; nothing sent), and the production environment variables.
