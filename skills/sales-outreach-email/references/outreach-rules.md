# Outreach and Email Rules

Source: CEO/Manager V2 spec §6 (action boundaries) and §9; PDF #10.

## Action honesty

- `prepare_email` → status DRAFT. Nothing has left the system.
- `send_email` → calls the configured provider adapter; only `sent` with a
  provider message id means delivery was accepted.
- `not_configured` leaves the record DRAFT and surfaces the reason. The UI
  must never show "sent" in that case.
- The quality check explicitly blocks drafts that say "has been sent" or
  "published successfully" without a provider result.

## Approval

- `send_email` is declared `external: true`, `risk: high` and is guarded by
  the approval engine (see `src/server/manager/execution-engine.ts` and
  `approval-policy.ts`). It will not execute until an approval decision of
  `approved` and non-expired is recorded.

## Provider abstraction

The `EmailProvider` interface isolates third-party specifics:

- `UnconfiguredProvider` is the default; returns `not_configured` from `send`.
- `ResendProvider` is available when `NIBREXO_EMAIL_PROVIDER=resend` AND
  `RESEND_API_KEY` AND `NIBREXO_EMAIL_FROM` are set. It is opt-in, never
  silently activated.
- Idempotency is enforced per-send via an `Idempotency-Key` header.
- HTTP 429 / 5xx return `retryable: true`; 4xx (except 429) returns
  `retryable: false`.

## Sequence stop conditions (auto-appended)

- "Stop when the recipient replies."
- "Stop when the recipient opts out."

These are added to every sequence in addition to any user-supplied stop
conditions.

## Content rules

Outreach copy must obey the claim policy:

- No invented testimonials, case studies, or fake customer results.
- No guaranteed-outcome language.
- No medical claims.
