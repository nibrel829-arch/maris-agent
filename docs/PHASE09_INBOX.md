# Phase 9 — Unified Inbox

**Canonical product scope:** PDF #12, §§2, 4, 10–11, 17, and 20. The §11 workflow is platform event or sync → provider adapter → normalized conversation/message → inbox → optional human-reviewed draft → original platform API → verify and log. Phase 9 reuses the existing Phase 5–8 tenant, CRM, OAuth, social-account, permission, audit, and UI architecture. It does not change those phases' UX or build the Phase 12 AI agent.

**Official API review:** 7 October 2026. “Integrated” means a server-side adapter is implemented in this repository; “available, not integrated” means the official API exists but this inbox does not call it; “unsupported” means the connected-account API surface does not provide the described inbox feature. Those distinctions are exposed by `inboxProviderStatuses()` and the `/inbox` capability matrix.

## Data and resource APIs

Migration `0010_unified_inbox.sql` extends the existing `conversations` and `messages` tables and adds normalized `inbox_participants`, per-account `inbox_sync_states`, idempotent `inbox_reply_attempts`, and an RLS-protected webhook receipt table reserved for a future verified webhook integration. Composite foreign keys tie conversations to accounts and CRM clients in the same organization, and tie messages/participants to conversations in that organization. Provider IDs are unique within their conversation/account scope. Tokens are never stored in inbox rows.

The normalized types are in `src/types/inbox.ts`; memory and Supabase implementations live in `src/server/db/memory-inbox.ts` and `src/server/db/supabase-inbox.ts`. Resource endpoints:

- `GET /api/workspace/inbox` — tenant-scoped, paginated list, search, filters, unread count, account list, provider capabilities.
- `GET /api/workspace/inbox/:conversationId` — conversation, participants, message timeline, sync metadata, and reply readiness/limitation.
- `PATCH /api/workspace/inbox/:conversationId` — read state, status, and same-organization CRM client association.
- `PATCH /api/workspace/inbox/:conversationId/messages/:messageId/draft` — save/clear a draft; never sends it.
- `POST /api/workspace/inbox/:conversationId/reply` — manual, permission-gated provider send with an `Idempotency-Key`.
- `POST /api/workspace/inbox/accounts/:accountId/sync` — authenticated, organization-owned on-demand polling.
- `GET|POST /api/cron/inbox` — server cron sweep, guarded by a timing-safe `CRON_SECRET`/`NIBREXO_CRON_SECRET` comparison.

## Current provider matrix

| Connected platform | Comment read | Comment reply | Direct messages | Sync |
| --- | --- | --- | --- | --- |
| YouTube | **Integrated** — channel-associated threads via YouTube Data API v3; requires stored `youtube.force-ssl` consent and an unambiguous channel identity. | **Integrated** — `comments.insert`, only when provider `canReply` is true; the inserted comment is read back and checked before success. | **Unsupported** — no creator/customer DM inbox endpoint. | Polling; YouTube push notifications cover video upload/metadata changes, not comments. |
| Facebook Pages | **Integrated, read-only** — managed Page feed/comment streams; requires `pages_read_engagement` and `pages_read_user_content` and the existing connected Page-token flow. | **Available in Meta's Page API surface but not integrated** — no reply is sent by this inbox. | **Available in Messenger Platform but not integrated** — DM ingestion, policy-window handling and send are not wired here. | Polling. Meta Page `feed` webhooks exist but are not integrated. |
| Instagram | **Available, not integrated** — professional-account comment moderation exists, but current connection scopes/adapter do not include it. | **Available, not integrated.** | **Available, not integrated** — professional-account messaging exists. | None. |
| LinkedIn | **Available, not integrated** — Community Management API access/product approval and organization roles/scopes are prerequisites. | **Available, not integrated.** | **Unsupported for the current connected social API surface** — no general member DM inbox/reply integration. | None. |
| TikTok | **Unsupported for connected creator inbox** — Research API comments are restricted to approved research use; ads-comment operations are not organic creator inbox access. | **Unsupported for connected creator inbox** — ad-comment reply is not a creator comment reply API. | **Unsupported for the connected creator API** — portability exports are not a live inbox or send API. | None. |
| Pinterest | **Unsupported** — no comment inbox/reply endpoints in the connected API surface. | **Unsupported.** | **Unsupported** — no DM conversation/send endpoints. | None. |
| Contra | **Unsupported** — no public connected inbox/comment endpoints documented for this provider integration. | **Unsupported.** | **Unsupported.** | None. |

Direct-message and reply classifications are intentionally not inferred from publishing scopes. Instagram, Messenger, and LinkedIn may support features for some products/accounts, but Nibrexo does not expose them until those grants and adapters are actually integrated and tested.

## Polling, bounded reads, retries

Polling is the selected Phase 9 sync model. There is no inbox webhook route and no webhook is claimed as active. `syncInboxAccount` uses the server-only job repository after rechecking the request actor, organization ownership, connected account, granted scopes and supported adapter. It claims a per-account lease, refreshes tokens through the existing server-side token service, persists provider cursors, deduplicates normalized external IDs, audits success/failure and schedules exponential retry after failures. The background sweep reads only supported YouTube/Facebook accounts that are due; on-demand sync is also available in the UI.

A poll is bounded to three YouTube API pages (up to 100 threads per page) per run; a remaining YouTube `pageToken` is persisted and resumed on the next poll. Facebook reads the ten most recent Page feed posts and up to two comment pages per post per poll, and retains per-post comment cursors for continuation. Provider rate limits, failed authorization, transient errors and cursor continuation are surfaced without revealing token material. The UI reports when provider pages remain. Because these reads are deliberately bounded, a very high-volume account can take multiple poll cycles to catch up; the Facebook feed query is limited to the ten recent posts and does not yet walk older feed pages.

`commentThreads.list` may return a partial embedded reply list. The stored total and loaded reply counts are compared; the UI labels a YouTube timeline **Partial history** when the API's returned thread summary does not contain every reported reply. Individual attachments are stored/displayed as safe type/label metadata only; the UI does not fetch provider media.

## Reply safety and approvals

YouTube is the only provider wired to send. The service requires the inbox `send` role permission, a visible same-organization conversation/account pair, a connected account, an open comment thread, the provider's `canReply` confirmation, the stored `youtube.force-ssl` scope, and the matching idempotency key/request hash. A unique unresolved-attempt constraint serializes concurrent sends per thread. Provider acceptance is not reported as success until YouTube `comments.list` confirms the returned comment ID, parent thread ID and text. Ambiguous acceptance is recorded as `unknown`; the system blocks a second send until the operator checks the provider thread. Facebook replies and all DMs remain unavailable in the composer.

There is no automatic AI send. A saved draft is explicitly labeled **not sent**; a human must edit/confirm through the composer and press Send, and the role matrix independently gates sending. This is the approval boundary for Phase 9; the full AI reply agent is out of scope.

## Tenancy, permissions, audit

All authenticated resource reads and updates are filtered by `actor.organizationId` and guarded by the inbox view/edit/send permission matrix. Provider calls and decrypted credentials remain server-side. The request repository is used to establish actor-visible ownership; service-role repository access is confined to the server-side token/sync/reply writes after those ownership checks. RLS is enabled for all new tables; tenant membership controls reads where appropriate, server/admin policies control ingestion and sensitive writes, and identity-immutability triggers prevent cross-tenant row moves. Composite organization/account/conversation/client foreign keys add relational enforcement. Conversation read/status/client changes, draft saves, provider sync outcomes and reply outcomes are audited. API responses and UI state contain no access/refresh tokens.

No webhook authenticity or replay handling is active because no webhook endpoint is enabled. The receipt table and repository claim/update methods are not evidence that a provider webhook is configured. If a webhook is added later, signature validation and replay protection must be implemented and tested before registering it with a provider.

## Official references

- YouTube `commentThreads.list`: <https://developers.google.com/youtube/v3/docs/commentThreads/list>
- YouTube comments implementation guide: <https://developers.google.com/youtube/v3/guides/implementation/comments>
- YouTube `comments.insert`: <https://developers.google.com/youtube/v3/docs/comments/insert>
- YouTube `comments.list`: <https://developers.google.com/youtube/v3/docs/comments/list>
- YouTube push notifications: <https://developers.google.com/youtube/v3/guides/push_notifications>
- Meta v26 Page Feed: <https://developers.facebook.com/docs/graph-api/reference/v26.0/page/feed>
- Meta v26 Post Comments: <https://developers.facebook.com/docs/graph-api/reference/v26.0/post/comments>
- Meta v26 Comment/Replies: <https://developers.facebook.com/docs/graph-api/reference/v26.0/comment/comments>
- Meta Page API setup: <https://developers.facebook.com/docs/pages-api/getting-started>
- Meta Instagram API with Instagram Login: <https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/>
- Meta Instagram overview: <https://developers.facebook.com/docs/instagram-platform/overview/>
- Meta Messenger Platform overview: <https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview>
- Meta Webhooks overview and Page reference: <https://developers.facebook.com/docs/graph-api/webhooks> and <https://developers.facebook.com/docs/graph-api/webhooks/reference/page>
- LinkedIn Comments API: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-05>
- LinkedIn Organization Social Action Notifications: <https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-social-action-notifications?view=li-lms-2026-04>
- TikTok Research API comments: <https://developers.tiktok.com/docs/en/research-api-specs-query-video-comments>
- TikTok Business ad-comment reply: <https://business-api.tiktok.com/portal/docs/reply-to-a-comment/v1.3>
- Pinterest API v5: <https://developers.pinterest.com/docs/api/v5/introduction/>

