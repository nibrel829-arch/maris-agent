---
name: content-marketing
description: >-
  Content assets and marketing campaign plans. Use this skill when the request
  asks for content drafts (captions, posts, long-form, campaign copy) or
  marketing campaign plans (objective, audience, channels, messages, timeline,
  success measures). Drafting is internal; publishing always routes through
  platform validation and the approval engine.
tools:
  - create_content_item
  - update_content_item
  - list_content_items
  - generate_caption
  - create_campaign_plan
  - list_campaign_plans
work_types:
  - content
  - marketing
  - strategy
outputs:
  - content_draft
  - campaign_plan
max_risk: medium
version: "1.0"
---

# Content Marketing

Creates and manages content drafts and marketing campaign plans.

## When to use

- "Write a caption for…", "Draft a post about…", "Create a long-form piece on…"
- "Plan a campaign for…" (objective, audience, channels, messages, timeline)
- Listing or updating existing content items in the workspace
- Generating copy skeletons per platform/channel brand voice

## When NOT to use

- Actually publishing or scheduling content → `social-community` (which stops
  for approval and goes through the adapter).
- Visual layout/asset specs → `visual-content`.
- Sales outreach or personalised emails → `sales-outreach-email`.

## Hard rules

- New content is created in DRAFT status. Drafts never auto-publish.
- Copy follows the organization brand voice; no superlatives without evidence,
  no guaranteed-outcome language, no unsourced statistics, no medical claims.
- A caption or campaign message that asserts a completed external action
  ("has been sent", "published successfully") is a blocking quality finding
  when still a draft.
- When no AI provider key is present, `generate_caption` returns a structured
  copy skeleton — it never emulates an AI response.

## References

- Brand voice: `src/knowledge/brand-voice.json`
- Claim policy and fabrication rules: `src/knowledge/claim-policy.json`
- Content status lifecycle (DRAFT → VALIDATING → READY → …): PDF #04 §7
