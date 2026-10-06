---
name: social-community
description: >-
  Social publishing plans and community management. Use this skill when the
  request asks for a social content plan (cadence, themes, pillars), a
  community management plan (response guidelines, escalation), or to list
  connected social accounts and their verified capabilities. PUBLISHING and
  SCHEDULING are external high-risk actions that require approval and only run
  through an official platform adapter; platforms whose API integration has
  not been verified report `unsupported` rather than faking a result.
tools:
  - list_social_accounts
  - create_social_plan
  - publish_post
  - schedule_post
  - create_community_plan
  - create_content_item
work_types:
  - social_media
  - community_management
  - marketing
outputs:
  - social_plan
  - community_plan
max_risk: high
version: "1.0"
references:
  - references/social-rules.md
---

# Social & Community

Plans social presence and community management across supported platforms.

## When to use

- "Plan our LinkedIn cadence", "Build a community response guide"
- Listing connected social accounts and their capability maps
- Creating a social plan (platforms, cadence, themes, pillars)
- Creating a community plan (response guidelines, escalation, engagement rituals)

## When NOT to use

- Writing the actual caption/body copy → `content-marketing`
- Producing visual concepts or asset specs → `visual-content`

## Hard rules

- `publish_post` and `schedule_post` are `external: true`, high-risk, and
  require approval.
- Platform capabilities are reported per-adapter from verified official APIs.
  If OAuth credentials, scopes or endpoint behaviour have not been verified,
  capabilities are `false` and calls return `unsupported` — no scraping, no
  simulation, no fake success.
- Scheduled posts require an explicit timezone; default is UTC.
- One platform failure never erases another platform's result.
- Content is promoted through DRAFT → VALIDATING → READY → SCHEDULED /
  PUBLISHING → PUBLISHED. PARTIAL and FAILED are reported, not hidden.

## Platforms

TikTok, YouTube, Pinterest, LinkedIn, Instagram, Facebook, Contra.
All adapters currently report `unsupported` until official APIs are verified
per platform (see `src/server/integrations/social/adapter.ts`).

## References

- Brand voice: `src/knowledge/brand-voice.json`
- Social adapter: `src/server/integrations/social/adapter.ts`
- Social rules: `references/social-rules.md`
- PDF #09 Social Media Integration & Publishing Specification
