---
name: sales-outreach-email
description: >-
  Sales plans, outreach sequences and client email preparation. Use this skill
  when the request asks to prepare sales outreach, draft a client email, build
  a follow-up sequence, or personalise a template. Drafting is internal and
  low risk; SENDING is an external high-risk action that always requires
  explicit approval and only executes through a configured email provider
  adapter. When no provider is configured, drafts remain drafts and the skill
  reports not_configured — it never fakes delivery.
tools:
  - create_email_template
  - list_email_templates
  - prepare_email
  - create_email_sequence
  - send_email
  - create_client
  - list_clients
work_types:
  - sales
  - outreach
  - email_workflow
outputs:
  - outreach_draft
  - email_draft
  - email_sequence
  - sales_plan
max_risk: high
version: "1.0"
references:
  - references/outreach-rules.md
---

# Sales / Outreach / Email

Prepares sales plans, outreach sequences and client emails. Drafting is
internal; sending is an external action subject to approval and provider
configuration.

## When to use

- "Write an outreach email to…", "Draft a follow-up sequence for…"
- Creating an organization-scoped email template with variables
- Personalising a template for a recipient
- Creating a follow-up sequence with delays and stop conditions
- Preparing (not sending) a client email

## When NOT to use

- Actually publishing to social platforms → `social-community`
- Internal notifications / system emails only → `manager-orchestration`

## Hard rules

- `prepare_email` creates a record in DRAFT status. It is NOT sending.
- `send_email` is external, high-risk, requires approval, and only runs through
  a configured provider adapter. If `RESEND_API_KEY` / `NIBREXO_EMAIL_FROM` are
  absent, it returns `not_configured` and leaves the record in DRAFT.
- The system never claims an email was sent unless the provider returned a
  provider message id.
- Idempotency keys prevent duplicate sends on retry.
- Unresolved `{{variable}}` placeholders fail the send with a clear error.
- Already-sent records are not sent again (duplicate protection).
- Stop conditions are automatically appended to every sequence (reply, opt-out).
- Outreach copy must follow brand voice and claim policy: no invented case
  studies, no fake social proof.

## References

- Brand voice: `src/knowledge/brand-voice.json`
- Claim policy: `src/knowledge/claim-policy.json`
- Provider adapter: `src/server/integrations/email/provider.ts`
- Outreach rules: `references/outreach-rules.md`
- PDF #10 Email Automation & Client Communication
