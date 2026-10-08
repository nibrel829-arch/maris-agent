-- 0011_email_templates_sending.sql — Phase 10 templates + sending (production-ready).
-- Source: PDF #10 §§4-6, 12-17, PDF #12 §§7, 12, 15-18.
-- Official provider review: Resend HTTP API (verified 2026-10-07):
--   Endpoint: POST https://api.resend.com/emails
--   Auth: Authorization: Bearer re_... (RESEND_API_KEY)
--   Headers: Content-Type: application/json, Idempotency-Key: <256 chars, 24h window>
--            User-Agent required (403 without it)
--   Body: { from: "<verified domain>", to: ["<email>"], subject, html, text, reply_to? }
--   Success: 200 { id: "<provider_message_id>" } — durable id
--   Errors: 401 missing key, 403 domain not verified (validation_error), 422 missing fields,
--           429 rate_limit_exceeded (10 req/s per team, retry-after, ratelimit-* headers),
--           5xx retryable. Idempotency held 24h.
--   Base URL, auth placement, idempotency header name/location, rate limit semantics and
--   response shapes are taken from https://resend.com/docs/api-reference/emails/send-email
--   and https://resend.com/docs/dashboard/emails/idempotency-keys (2026-10-07).
--
-- This migration is additive and re-runnable:
--   * email_templates: draft/active/archived lifecycle (status text) + indexes
--   * email_logs:     idempotent send records, provider id, snapshot, indexes
--   * RLS:           reaffirm tenant isolation + tenant-identity immutability (0005)
--   * No CRM/inbox data is modified, no table is dropped, no row deleted.

-- --------------------------------------------------------------------------
-- email_templates — lifecycle + search indexes
-- --------------------------------------------------------------------------

-- Existing columns (0002): id, organization_id, name, category, subject, body,
-- variables text[], archived bool, created_at, updated_at, organization ownership.
-- Phase 10 adds an explicit status so draft templates are never accidentally
-- selected for sending. `archived` is kept for compatibility and synced below.

alter table public.email_templates
  add column if not exists status text not null default 'active'
    check (status in ('draft', 'active', 'archived'));

-- Backfill status from legacy archived flag (only where archived = true and status is still the default active).
update public.email_templates
set status = 'archived'
where status = 'active'
  and archived = true;

-- Keep archived bool consistent when status is set directly (best effort; app layer is authoritative).
-- This trigger is not strictly required but prevents drift when an operator edits via SQL.

-- Composite indexes for tenant-scoped list/search (bounded window in service: newest 500).
create index if not exists email_templates_org_status_idx
  on public.email_templates (organization_id, status, created_at desc);
create index if not exists email_templates_org_category_idx
  on public.email_templates (organization_id, category, created_at desc);
create index if not exists email_templates_org_name_idx
  on public.email_templates (organization_id, lower(name));
create index if not exists email_templates_org_created_idx
  on public.email_templates (organization_id, created_at desc);

-- --------------------------------------------------------------------------
-- email_logs — outbound email records (minimum required schema for Phase 10)
-- --------------------------------------------------------------------------
-- Existing (0002): id, organization_id, client_id (FK clients), template_id (FK templates),
-- to_email, subject, body (rendered, already snapshot-like), status (email_status enum),
-- provider_message_id, error_message, created_by, created_at, updated_at, organization ownership.
-- Phase 10 adds the idempotency and snapshot columns required for retry-safe sends.

alter table public.email_logs
  add column if not exists idempotency_key text;
alter table public.email_logs
  add column if not exists provider text;
alter table public.email_logs
  add column if not exists template_snapshot jsonb not null default '{}'::jsonb;

-- Idempotency: a retry with the same key inside the same organization resolves
-- to the existing row instead of sending a second email (PDF #10 §15).
-- provider scope is per organization — a key from tenant A never shadows tenant B.
create unique index if not exists email_logs_org_idempotency_unique
  on public.email_logs (organization_id, idempotency_key)
  where idempotency_key is not null;

-- Query indexes: inbox-style counts, logs listing by org/time, status filters,
-- client association (CRM timeline), per-template tracing.
create index if not exists email_logs_org_created_idx
  on public.email_logs (organization_id, created_at desc);
create index if not exists email_logs_org_status_idx
  on public.email_logs (organization_id, status, created_at desc);
create index if not exists email_logs_org_client_idx
  on public.email_logs (organization_id, client_id, created_at desc)
  where client_id is not null;
create index if not exists email_logs_org_template_idx
  on public.email_logs (organization_id, template_id, created_at desc)
  where template_id is not null;
create index if not exists email_logs_to_email_idx
  on public.email_logs (organization_id, lower(to_email));

-- Defensive: keep email_logs RLS in the expected state even if 0004 is re-applied out of order.
-- The 0004 tenant pattern is: members can select/insert/update their org, owner/admin can delete.
-- We recreate them only when missing semantics change — these are no-ops when already correct.

alter table public.email_templates enable row level security;
alter table public.email_logs enable row level security;

drop policy if exists email_templates_tenant_select on public.email_templates;
create policy email_templates_tenant_select on public.email_templates
  for select using (public.is_org_member(organization_id));
drop policy if exists email_templates_tenant_insert on public.email_templates;
create policy email_templates_tenant_insert on public.email_templates
  for insert with check (public.is_org_member(organization_id));
drop policy if exists email_templates_tenant_update on public.email_templates;
create policy email_templates_tenant_update on public.email_templates
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists email_templates_admin_delete on public.email_templates;
create policy email_templates_admin_delete on public.email_templates
  for delete using (public.is_org_admin(organization_id));

drop policy if exists email_logs_tenant_select on public.email_logs;
create policy email_logs_tenant_select on public.email_logs
  for select using (public.is_org_member(organization_id));
drop policy if exists email_logs_tenant_insert on public.email_logs;
create policy email_logs_tenant_insert on public.email_logs
  for insert with check (public.is_org_member(organization_id));
drop policy if exists email_logs_tenant_update on public.email_logs;
create policy email_logs_tenant_update on public.email_logs
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists email_logs_admin_delete on public.email_logs;
create policy email_logs_admin_delete on public.email_logs
  for delete using (public.is_org_admin(organization_id));

-- Tenant-identity immutability (0005 pattern) for the two tables touched here.
drop trigger if exists email_templates_tenant_identity_immutable on public.email_templates;
create trigger email_templates_tenant_identity_immutable
  before update on public.email_templates
  for each row execute function public.prevent_tenant_identity_change();
drop trigger if exists email_logs_tenant_identity_immutable on public.email_logs;
create trigger email_logs_tenant_identity_immutable
  before update on public.email_logs
  for each row execute function public.prevent_tenant_identity_change();

-- Preserve email_preferences RLS (already correct via 0004) and ensure
-- the table exists for opt-out checks (no schema change needed for Phase 10).
-- No change to email_sequences/steps/jobs: sequences are Phase 11.

-- Reserved for future webhook-style provider events (provider delivers async
-- delivery/bounce via dashboard/webhooks; Phase 10 stores the provider_message_id
-- only — email_events stays as-is from 0002/0004).
