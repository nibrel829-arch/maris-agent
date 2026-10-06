# Social Publishing & Community Rules

Source: PDF #09 Social Media Integration & Publishing Specification;
CEO/Manager V2 spec §6 and §9.

## Adapter rule (PDF #09 §19)

Each platform must have, before publishing can be enabled:

1. Verified OAuth configuration (client id/secret from environment).
2. Verified scopes documented for each operation.
3. Verified endpoint behaviour against current official documentation.

Until all three are recorded, the platform's adapter reports
`capabilities() = { publish: false, schedule: false, … }` and calls return
`unsupported`. There is no scraping, no emulation, no fake post id.

## Capability operations

- `publish` — immediate post to the platform.
- `schedule` — future post with explicit timezone.
- `readDm` / `sendDm` — direct messages (inbox integration roadmap).
- `readComments` / `replyComments` — comment threads (roadmap).
- `analytics` — platform metrics (roadmap).

## Content lifecycle

```
DRAFT → VALIDATING → READY → SCHEDULED / PUBLISHING → PUBLISHED
                                                 ↘ FAILED / PARTIAL / CANCELLED
```

- Drafts never auto-publish.
- `PARTIAL` = at least one platform succeeded and at least one failed.
- `FAILED` = no platform succeeded.
- One platform failure must not roll back or hide another platform's success.

## Community management

Plans include:

- Response guidelines (tone, SLA, do/don't language).
- Escalation rules (when to route to a human).
- Engagement rituals (recurring community actions).

Inbox ingestion and auto-responder execution are roadmap items; they are not
faked in the current build.
