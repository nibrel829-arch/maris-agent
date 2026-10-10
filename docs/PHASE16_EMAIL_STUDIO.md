# Phase 16 — Visual Email Design & Campaign Studio

**Canonical product scope:** the Phase 16 request (upgrade the existing Email Templates feature into a professional, enterprise-style visual email design and campaign studio), building on the Phase 10 email automation spec (PDF #10) and the Phase 12 architecture rules (PDF #12 §16). Phase 16 replaces nothing that already worked: the Phase 10 template CRUD, composer, sequences, idempotent send pipeline, `email_logs` audit trail and the Resend provider adapter are reused unchanged.

**What this phase is not:** it is not a plain HTML textarea, not a component list with mock previews, and not a second media system. The canvas renders the real rendered email document, and every image comes from the existing Content Library.

---

## 1. What was implemented

### 1.1 Design document contract (`src/types/email-design.ts`)

One discriminated-union document format is the single contract between the browser builder, the renderer, the Manager tools, the API and the database:

- `EmailBlock` is a union on `type` over 14 blocks: `header`, `hero`, `banner`, `video`, `products`, `gallery`, `promo`, `text`, `button`, `social`, `spacer`, `divider`, `background`, `footer`.
- `EmailDesignDocument` = `{ version, blocks, brand, settings }`; brand tokens carry the organization's colours, typography and button style.
- `EmailBrandProfile` adds the org-level design system: logo, colours, typography, button style, header/footer defaults and `savedSections` (reusable sections).
- The types contain no Node or framework APIs, so they are importable from client components, route handlers, tools and tests alike.

### 1.2 Render pipeline (`src/server/email/render/`)

`renderEmail(design, { variables, resolveAssetUrl, subject })` → `{ subject, html, text, preheader, unresolvedVariables, validation }`.

| Module | Responsibility |
| --- | --- |
| `schema.ts` | Zod schemas for the document, every block and the brand profile; defaults are applied here so a Manager- or API-authored document that omits canvas settings still renders. `parseDesignDocument` / `parseBrandProfile` return structured errors. |
| `url.ts` | Scheme allow-list (`http`, `https`, `mailto`, `tel`). `javascript:`, `data:`, `vbscript:`, `file:` and relative URLs are rejected; `{{variables}}` inside a URL are deferred to send time. |
| `sanitize.ts` | `escapeHtml` / `escapeAttr` for every plain field, plus `sanitizeRichText` for the one field that accepts a formatting subset (`b/strong/i/em/u/a/p/br/ul/ol/li/h1–h4/span/blockquote`). The subset is re-serialised from a parsed token stream, so unknown tags, unknown attributes and event handlers cannot survive. |
| `render-html.ts` | Table-based document with `role="presentation"`, inline CSS on every element, a single `<style>` block for the mobile media query, Outlook `mso` conditional tables and VML bulletproof buttons. Every block renders as exactly one well-formed `<tr><td …>…</td></tr>` row of the container table. |
| `render-text.ts` | Plain-text alternative: `label — url` for links, alt text for images, and the unsubscribe/preferences instruction when the design has a footer. |
| `validate.ts` | Report (never a throw): broken/unsafe/empty links, missing images, missing alt text, missing unsubscribe link, empty designs. Errors block a test send and promotion; warnings and info are advisory. |
| `index.ts` | Normalise → substitute `{{variables}}` → resolve assets → HTML → text → validate. `renderEmailFromUnknown` renders untrusted JSON. |

The renderer tags each block with `<tbody data-email-block="<id>">`, which is what lets the canvas locate, select and reorder the **real** rendered element inside the preview iframe.

### 1.3 Private Content Library assets (`src/server/email/asset-url.ts`)

There is no public media URL in this product. A Content Library `mediaId` is turned into an HMAC-SHA256-signed, expiring URL:

```
GET /api/workspace/email/assets/{mediaId}?exp=<unix>&org=<uuid>&sig=<hex>
```

The signature covers `mediaId.organizationId.exp` with a server-only secret (`NIBREXO_EMAIL_ASSET_SECRET`, ephemeral in dev), TTL 30 days by default. The route re-verifies the signature with `timingSafeEqual`, checks the expiry, confirms the media row belongs to the caller's organization and streams the bytes through the existing private `nibrexo-media` storage adapter. A missing/tampered/expired token or a cross-tenant media id returns 403 `ASSET_TOKEN_INVALID` (or 404 `ASSET_NOT_FOUND`), never the file. The canvas and the delivered email use the same URL, so the preview is the artefact.

### 1.4 Service layer (`src/server/email/design-service.ts`, `design-validation.ts`, `starter-templates.ts`)

Every function follows the existing pipeline (authenticate → authorize → validate → database → external provider → audit → `ServiceResult`) and is scoped by `actor.organizationId`:

`listDesigns`, `getDesign`, `createDesign`, `updateDesign`, `deleteDesign`, `duplicateDesign`, `renderDesign`, `renderDesignDocument`, `renderDraftDesign`, `sendDesignTestEmail`, `promoteDesignToTemplate`, plus brand `getBrandProfile`, `updateBrandProfile`, `saveBrandSection`, `deleteBrandSection`.

Six polished starter designs (`starter-welcome`, `starter-newsletter`, `starter-product-launch`, `starter-promo`, `starter-announcement`, `starter-client-update`) are complete, editable documents made of the same blocks the builder edits — not screenshots. Placeholder destinations are intentional and are reported as `LINK_DEFERRED` info issues that must be replaced before a campaign.

### 1.5 Database (`supabase/migrations/0012_email_design_studio.sql`)

Two new tables, both RLS-protected with the same identity-immutability triggers as the rest of the schema:

- `email_designs` — the design JSON, `status` (`draft|active|archived`), `source` (`studio|manager|starter|template`) and `template_id` (set on promotion).
- `email_brand_profiles` — one row per organization; `savedSections` lives inside the `brand` JSON column, so no third table was needed.

The existing 20 000-character `email_templates.body` limit is not worked around: a design is stored as JSON, and HTML is written into `email_templates.body` only at promote or send time.

### 1.6 API (`src/app/api/workspace/email/…`)

| Route | Purpose |
| --- | --- |
| `GET/POST /designs` | Directory (search/status/category/source/pagination) and create. |
| `GET/PATCH/DELETE /designs/[id]` | Read, update, delete. |
| `POST /designs/[id]/duplicate` | Copy inside the same organization (always a draft). |
| `POST /designs/[id]/render` | Render a saved design (HTML + text + validation). |
| `POST /designs/render-draft` | Render an **unsaved** document — this is what the canvas calls (350 ms debounce) so the preview is the real artefact before autosave. |
| `POST /designs/[id]/test-send` | One permission-gated test email through the existing provider. |
| `POST /designs/[id]/promote` | Write the rendered design into `email_templates` (draft by default). |
| `GET/PUT /brand`, `POST/DELETE /brand/sections[/id]` | Organization brand + design system, reusable sections. |
| `GET /starters` | The starter gallery. |
| `GET /assets/[mediaId]` | Signed, expiring, org-scoped asset streaming. |

### 1.7 Studio UI (`src/features/email/studio/`, `src/app/(workspace)/email/…`)

- `/email/studio` — saved designs, starters, "New design" (seeded from the brand profile).
- `/email/studio/[id]` — the builder: block library on the left, canvas in the middle, properties panel on the right.
- `/email/brand` — brand & design system form.
- `EmailStudioBuilder` owns the document, undo/redo (50 steps, ⌘/Ctrl+Z / ⇧⌘Z), autosave (1.4 s debounce via PATCH), live render (350 ms debounce via `render-draft`), device toggle (desktop 760 px / mobile 375 px), and the Design / HTML / Text / Validation / Test-send tabs.
- `DesignCanvas` loads the server-rendered HTML into an iframe via `srcDoc` and overlays selection outlines, drag handles and drop indicators measured from the real `[data-email-block]` elements. Drag-and-drop supports insert (from the library), reorder (from the canvas) and saved-section insert; the drop position is computed from the element's midpoint.
- `BlockLibrary` lists all 14 blocks with labels/descriptions, plus the organization's saved sections.
- `PropertiesPanel` edits the selected block: content, image (AssetPicker), links, alignment, colours, columns, sizes, CTA, product/gallery/social lists.
- `AssetPicker` reuses the existing Content Library: it lists the organization's media, uploads through the existing upload route, or accepts an external URL, and always keeps an `alt` text.
- `TestEmailPanel` sends a labelled test (`[Test] …`) with variable substitution and reports the real provider outcome.
- `BrandSettingsForm` edits logo, colours, typography, button style, header/footer defaults.
- The sidebar gains **Email templates** and **Design studio** entries; `/email` gains a studio card and primary action.

### 1.8 Manager integration (`src/server/tools/email.ts`, `src/server/manager/planner.ts`)

Six new tools, declared in the existing `sales-outreach-email` and `visual-content` skill files (so `SKILL_IDS` stays at 11 and `validateRegistry(toolNames())` stays `[]`):

| Tool | Permission | Risk |
| --- | --- | --- |
| `list_email_design_starters` | email:view | low |
| `create_email_design` | email:create | low |
| `list_email_designs` | email:view | low |
| `update_email_design` | email:edit | low |
| `render_email_design` | email:view | low |
| `promote_email_design` | email:create | medium |

The planner routes a designed-email request ("Create a premium product-launch email with our brand header, a full-width banner, three product cards, a video thumbnail, a CTA and our standard footer. Save it as a draft.") to `create_email_design` with the matching starter and `status: 'draft'`, whether the request classifies as `email_workflow` or `visual_communication`. Promotion is only planned when the user asks for a sendable template. An explicit "send it to …" still routes through `prepare_email` → `send_email`, which stops for approval.

**Nothing auto-sends.** Manager-created designs are `draft`; only `active` templates are selectable for sending in the composer; promotion never activates a template; the only send path is a permission-gated, idempotent test email through the existing provider adapter, which honours the existing approval gates.

### 1.9 Safety properties

- No JavaScript in generated emails: no `<script>`, no `on*` handlers, no `<iframe>`, no `<video>`, no external stylesheets, no `@import`, no web fonts.
- Video blocks render as a clickable thumbnail (with a play-button overlay) that opens the video in a browser, and validation emits an explicit `VIDEO_LINK_ONLY` info issue stating that inline playback is not assumed in any email client.
- Every user string is escaped; the only markup accepted is the sanitised rich-text subset; every URL is scheme-checked.
- Marketing emails are validated for an unsubscribe (and preferences) destination; the plain-text alternative always carries the unsubscribe instruction when the footer has one.
- Images always carry `alt` (validated as a warning when missing) and fall back to a labelled colour block so the layout never collapses.

---

## 2. What works end to end (verified in this workspace)

Executed against the running app (dev identity, in-memory backend, `npm run dev`):

| Flow | Result |
| --- | --- |
| `GET /api/workspace/email/starters` | 200, 6 starters, each with its variable list. |
| `POST /api/workspace/email/designs` (from a starter) | 201, `status: draft`, org-scoped. |
| `GET /api/workspace/email/designs` | 200, the created design listed. |
| `POST /designs/[id]/render` | 200, 15 KB of HTML, 0 errors / 2 expected `IMAGE_EMPTY` warnings, text alternative present. |
| `POST /designs/render-draft` (unsaved document) | 200, renders without persisting anything. |
| `POST /designs/[id]/promote` | 201, `email_templates` row with the rendered HTML as `body`, `status: draft`, `design.template_id` linked; re-promoting updates the same row. |
| `POST /designs/[id]/test-send` (with variables) | 503 `EMAIL_NOT_CONFIGURED` — no provider credentials in this sandbox; the failure is reported, not faked. Without variables: 400 `VARIABLES_MISSING`. Invalid recipient: 400. |
| `POST /designs/[id]/duplicate`, `PATCH`, `DELETE` | 201 / 200 / 200. |
| `GET/PUT /brand`, `POST/DELETE /brand/sections` | 200 / 200 / 201 / 200 — brand profile and reusable sections round-trip. |
| Upload a PNG through the existing Content Library route, reference it in a banner, render, fetch the signed URL | 200, `image/png`, exact bytes streamed. |
| Signed asset URL with a tampered signature / unknown media / no token | 403 `ASSET_TOKEN_INVALID`, 404 `ASSET_NOT_FOUND`, 400. |
| Pages `/email`, `/email/studio`, `/email/studio/[id]`, `/email/brand` | 200 with the studio shell, block library, canvas, properties panel and all five tabs. |
| Manager `create_email_design` → `list_email_designs` → `update_email_design` → `render_email_design` → `promote_email_design` | Unit-tested end to end; the promoted template lands in `email_templates` as a draft. |
| Manager planning for the Phase 16 example request | Plans `create_email_design` with `starter-product-launch` and `status: 'draft'`; plans `promote_email_design` only when asked; keeps `prepare_email` → `send_email` (approval-gated) for explicit send requests. |

Renderer output was additionally checked for well-formedness: a balanced-tag scan over a document containing **all 14 block types** and over all six starters reports zero mismatches or unclosed tags, and no `__BLOCK__` placeholders remain.

### 2.1 Final QA pass (all automated — see §3/§4 for what was *not* tested)

Every check below was executed against the running dev server with the in-memory backend and reported a pass count of **0 failures**.

| QA item | Check | Result |
| --- | --- | --- |
| Static checks, lint, tests, schema, build | `npm run typecheck`, `npm run lint`, `npm test`, `npm run verify:schema`, `npm run build` | 369 tests / 39 files pass; 42 tables, 14 enums, 158 policies; build exit 0 with **zero warnings and zero errors** (run twice: with and without `.env.local`). |
| Generated HTML integrity | Balanced-tag scan, `__BLOCK__`/`undefined`/`NaN`/`[object Object]` scan, block-wrapper and stray-text scan, hostile-markup escaping | **48 / 48 pass.** Hostile input (`<img src=x onerror>`, `<script>`, `javascript:`) arrives entity-escaped with no real event-handler attribute. |
| Complete sample email | Branded header + nav, image banner, hero, video thumbnail, 3-column catalogue, CTA, divider, footer | **96 / 96 pass** (15,287 B HTML + 1,252 B plain text, 0 errors / 0 warnings). Verified with a real HTML parser (`node-html-parser`): every `<tr>` has a table parent, every `<tr>` child is a `<td>`, all 8 blocks are wrapped, 5 images with alt text, 15 links with safe schemes, 3 × `width="33"` catalogue cells, and the mobile media-query rules (`.stack`, `.stack-table td`, `.email-container`, `.mobile-btn a`) switch those constructs to full width. |
| Visual editor | create draft → render canvas → add / edit / reorder / delete → autosave PATCH → reload | **46 / 46 pass.** Every mutation survives a reload of both the API and the `/email/studio/[id]` page. |
| Assets and access control | PNG uploaded through the existing Content Library, referenced, rendered, fetched through the signed URL; unsigned / tampered / expired / cross-org tokens; private-route authorization | **43 / 43 pass.** Signed URL returns 200 `image/png` with the exact bytes; unsigned → 400, tampered → 403, expired → 403, other org → 403; no bucket path or public storage URL is ever emitted. |
| Permissions, drafts, brand, Manager | org scoping, draft persistence, brand round-trip, saved sections, promoted-template status, `executeSteps` integration | draft persists as `status: draft`; brand colour/typography/button style/footer defaults round-trip; promoted template is a **draft** and absent from the sendable list; `executeSteps` proves real persistence + `email.design.created` audit, an approval-gated send halting with nothing delivered, and `PERMISSION_DENIED` for a `client` actor. |
| Test-email workflow | send without variables, with an invalid recipient, with no provider configured | 400 `VARIABLES_MISSING`, 400 on an invalid recipient, 503 `EMAIL_NOT_CONFIGURED`. **No campaign was sent and no success was fabricated** (see §4). |
| Audit trail | `/api/workspace/overview` recent activity | Records `email.design.created`, `email.design.promoted`, `email.design.test_failed`, `email.brand.section_saved`, `email.brand.section_deleted`. |

**A defect found and fixed during this pass.** Studio routes returned **400** for a missing design while every existing clients/templates route returns 404. `studioFailure` in `src/app/api/workspace/email/_shared.ts` now maps `/_NOT_FOUND$/` to 404 first; two regression tests cover GET/PATCH/DELETE.

**A second defect found and fixed during this pass.** The dev-only ephemeral asset secret was generated by a module-level `randomBytes(32)`, so in Next.js dev mode — where a route handler is evaluated in a different module registry from the code that minted the URL — the **first** request to a freshly compiled `assets/[mediaId]` route was rejected with 403 `ASSET_TOKEN_INVALID`. The secret now lives on `globalThis` under a `Symbol.for` key, so every registry in one process agrees on it. Verified live: a cold-compiled asset route returns 200 on its first request, with and without a durable secret configured. `NIBREXO_EMAIL_ASSET_SECRET` is now documented in `.env.example`.

---

## 3. Email clients: actually tested vs. designed for

**No email client and no browser engine was used in this workspace.** The sandbox has no Chromium/Firefox binary and no Playwright/Puppeteer install, and this environment has no outbound access to a browser-CDN, so nothing below was rendered by a real layout engine. Every claim in this section is either a **structural assertion on the parsed document** or a **design intent** — never an observation of how the email looks in a client.

**Actually executed in this workspace (automated, structural):**

- Balanced-tag/well-formedness scan of the rendered HTML for all 14 block types and all six starters (a proxy for "the strictest parser will not mangle this document").
- Assertions that the document contains no script/event-handler/iframe/video/external-stylesheet constructs.
- Byte-level checks that Content Library images resolve through the signed URL and that alt text, `width` and fallback blocks are present.
- End-to-end HTTP execution of every studio route listed above.
- A full parse of a complete sample email with a real HTML parser (`node-html-parser`), walking the DOM tree to assert parent/child relationships, then extracting the mobile media-query rules and asserting they switch the catalogue, container and buttons to full width. This verifies the *rules the document declares*; it does not prove any client applies them.

**Designed for, not executed here (no credentials or no client available in this sandbox):**

| Client | Designed-for technique | Status |
| --- | --- | --- |
| Gmail (web/Android/iOS) | Table layout, inline CSS, `max-width` + `width:100%`, hidden preheader, no web fonts. | Not rendered in a real Gmail client here. |
| Outlook 2016–365 (Windows, Word engine) | `mso` conditional tables, `v:roundrect` bulletproof buttons, `mso-padding-alt`, `PixelsPerInch` OfficeDocumentSettings. | Not opened in Outlook here. |
| Apple Mail / Mail on iOS | `x-apple-disable-message-reformatting`, `color-scheme` meta, `role="presentation"`. | Not opened here. |
| Mobile clients generally | `@media only screen and (max-width:620px)` stacking classes, 375 px preview, full-width buttons on mobile. | Media-query rules verified structurally; the 375 px canvas preview is a browser `<iframe>` preview only — not a real mobile client. |
| Images-off clients | `alt` on every `<img>`, labelled colour fallback blocks. | Verified in the HTML, not in a client. |
| Deliverability (SPF/DKIM/DMARC, spam placement) | Out of scope of this phase. | Not tested. |

A real rendering matrix (Litmus/Email on Acid or manual sends to Gmail/Outlook/Apple Mail) still has to be run before a campaign goes out; the document is built with those clients' documented constraints, but that is a design claim, not a test result.

---

## 4. Was a real test email delivered?

**No.** This sandbox has no email provider credentials (`NIBREXO_EMAIL_PROVIDER`, `RESEND_API_KEY`, `NIBREXO_EMAIL_FROM` are all unset), so the studio's test-send path correctly returns `503 EMAIL_NOT_CONFIGURED` instead of pretending to send. The path itself is wired to the existing Phase 10 provider adapter (Resend, verified 2026-10-07), with the same idempotency key, audit row and provider outcome handling as the composer's send. A real test send requires those three environment variables in a deployed environment; the studio UI, route, service and validation in front of it are all exercised here.

---

## 5. Commit, push and remote CI status

- **Commit:** `2a5585d` — *Phase 16: visual email design & campaign studio*
- **Branch:** `arena/f1a6c1c0-maris-agent`, pushed to `origin`.
- **Pull request:** [#8](https://github.com/nibrel829-arch/maris-agent/pull/8) — `main` ← `arena/f1a6c1c0-maris-agent`, 1 commit, 65 files, **MERGEABLE**.

Verification run locally before committing:

```
npm run verify         # typecheck + lint + tests  → 39 files / 369 tests passing
npm run verify:schema  # pglite: migrations 0001–0012 applied, 42 tables / 14 enums / 158 policies,
                       # all 20 required objects present, re-runnable 3x
npm run build          # next build → success, zero warnings
```

Remote checks on the PR (read through the GitHub API after opening #8):

| Check | Result |
| --- | --- |
| `Typecheck, lint and test` (GitHub Actions, Node 20, `npm ci`) | **pass** (1m1s) |
| `Vercel` deployment + `Vercel Preview Comments` | **success** — "Deployment has completed" |
| `Supabase` check suite | queued at the time of writing |

The Vercel build therefore really did run and pass. The **raw log lines are not readable** through the GitHub API (they live on Vercel's side behind auth), so I can confirm the build succeeded but cannot enumerate individual warnings. No Node version was changed and no install script was approved to make it pass: the repo declares `engines: >=20`, Next 15.5.27 supports `>=20`, and `package.json` has no preinstall/install/postinstall/prepare script. The only extra dependency used during QA was `@electric-sql/pglite`, installed with `--no-save` exactly as `scripts/verify-schema-pglite.mjs` documents, and it is not committed.

Phase 16 adds 6 test files / 81 tests (render pipeline 21, starters 8, signed asset URLs 12, design service + tenancy + brand 17, Manager tools + planner 14, studio API routes 9). The full suite is 39 files / 369 tests.

---

## 6. Remaining blockers and known limits

1. **No real email-client render matrix** (see §3) and **no real test email** (see §4) — both need credentials/a deployed environment.
2. **Cross-tenant asset leakage depends on the secret.** In production `NIBREXO_EMAIL_ASSET_SECRET` must be set explicitly; without it the process falls back to `NIBREXO_TOKEN_ENCRYPTION_KEY` or the Supabase credentials. If none of those exist either, a per-process ephemeral key is used, so signed URLs stop verifying after a restart (rendered emails would show image fallbacks) — and, more importantly, multiple server instances would each mint their own keys. The ephemeral key is now shared across module registries inside one process, but it is still per-process: **set `NIBREXO_EMAIL_ASSET_SECRET` before running more than one instance.**
3. **Asset URLs embed an absolute origin.** `resolveRequestOrigin` prefers `NIBREXO_APP_URL`, then forwarded headers, then the request origin. Behind a proxy that strips those headers the URLs would point at the internal host, so the deployment must set `NIBREXO_APP_URL`.
4. **Signed asset TTL is 30 days.** A long-lived email (e.g. a welcome message opened months later) can show the colour fallback instead of the image after expiry. Re-rendering the design mints fresh URLs; automatic re-rendering on open is not implemented.
5. **Nested block objects are strictly required** by the Zod schema (`blocks.0.props.logo: Required`). Hand-written partial documents are rejected rather than defaulted; the studio and the starters always write complete documents.
6. **Rich text is a small subset** by design (no tables/images inside a text block); use the dedicated image/gallery/product blocks instead.
7. **Product and gallery blocks cap at 12 items** and a document caps at 60 blocks; the UI reports the cap.
8. **Undo/redo is in-memory** (50 steps) and is lost on reload; autosave persists the document but not the history.
9. **Autosave conflict handling is last-write-wins** per design id; there is no multi-editor locking.
10. **Campaign sending is unchanged**: the studio prepares designs and drafts; scheduling, audience selection and batch sending remain the Phase 10 composer/sequence flows.
