-- 0012_email_sequences_execution.sql — Phase 11 sequences, enrollment, scheduling, suppression.
-- Sources: PDF #10 §§9-11, 15-18, PDF #12 §§7, 13-14.
-- Resend docs (verified 2026-10-08 for Phase 11):
--   Suppressions: https://resend.com/docs/dashboard/emails/email-suppressions
--     orig: bounce | complaint | manual, team-wide, skip on send, webhook suppression.added/removed
--   Events: https://resend.com/docs/webhooks/event-types
--     email.bounced/complained/delivered/suppressed, suppression.* via Svix signed webhooks
--
-- This migration is additive and re-runnable. It extends the 0002 skeleton
-- (email_sequences / email_steps / email_jobs / email_preferences) without
-- dropping or deleting data.

-- --------------------------------------------------------------------------
-- sequence_status: add archived lifecycle (Phase 11 start/pause/resume/archive)
-- --------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'sequence_status' and e.enumlabel = 'archived'
  ) then
    alter type public.sequence_status add value 'archived';
  end if;
end $$;

-- --------------------------------------------------------------------------
-- email_sequences — ensure columns expected by Phase 11 service
-- --------------------------------------------------------------------------
alter table public.email_sequences
  add column if not exists description text;
alter table public.email_sequences
  add column if not exists created_at timestamptz not null default now();
alter table public.email_sequences
  add column if not exists updated_at timestamptz not null default now();
-- already has name, trigger, steps jsonb, stop_conditions, status, created_by
create index if not exists email_sequences_org_idx
  on public.email_sequences (organization_id, created_at desc);
create index if not exists email_sequences_org_status_idx
  on public.email_sequences (organization_id, status, created_at desc);
alter table public.email_sequences enable row level security;
drop policy if exists email_sequences_tenant_select on public.email_sequences;
create policy email_sequences_tenant_select on public.email_sequences
  for select using (public.is_org_member(organization_id));
drop policy if exists email_sequences_tenant_insert on public.email_sequences;
create policy email_sequences_tenant_insert on public.email_sequences
  for insert with check (public.is_org_member(organization_id));
drop policy if exists email_sequences_tenant_update on public.email_sequences;
create policy email_sequences_tenant_update on public.email_sequences
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists email_sequences_admin_delete on public.email_sequences;
create policy email_sequences_admin_delete on public.email_sequences
  for delete using (public.is_org_admin(organization_id));
drop trigger if exists email_sequences_tenant_identity_immutable on public.email_sequences;
create trigger email_sequences_tenant_identity_immutable
  before update on public.email_sequences
  for each row execute function public.prevent_tenant_identity_change();

-- --------------------------------------------------------------------------
-- email_steps — normalized steps (alternative to jsonb `steps`)
-- --------------------------------------------------------------------------
alter table public.email_steps
  add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
alter table public.email_steps
  add column if not exists delay_hours integer not null default 0;
alter table public.email_steps
  add column if not exists body text;

-- Back-compat: existing rows get body = subject fallback where body empty
update public.email_steps set body = coalesce(body, subject) where body is null;

create index if not exists email_steps_org_sequence_idx
  on public.email_steps (organization_id, sequence_id, position);
alter table public.email_steps enable row level security;
drop policy if exists email_steps_tenant_select on public.email_steps;
create policy email_steps_tenant_select on public.email_steps
  for select using (public.is_org_member(organization_id));
drop policy if exists email_steps_tenant_insert on public.email_steps;
create policy email_steps_tenant_insert on public.email_steps
  for insert with check (public.is_org_member(organization_id));
drop policy if exists email_steps_tenant_update on public.email_steps;
create policy email_steps_tenant_update on public.email_steps
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists email_steps_admin_delete on public.email_steps;
create policy email_steps_admin_delete on public.email_steps
  for delete using (public.is_org_admin(organization_id));
drop trigger if exists email_steps_tenant_identity_immutable on public.email_steps;
create trigger email_steps_tenant_identity_immutable
  before update on public.email_steps
  for each row execute function public.prevent_tenant_identity_change();

-- --------------------------------------------------------------------------
-- email_sequence_enrollments — per-recipient execution state
-- --------------------------------------------------------------------------
create table if not exists public.email_sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id uuid not null references public.email_sequences (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  email text not null,
  status text not null default 'active'
    check (status in ('active','paused','completed','cancelled','unsubscribed','bounced','failed')),
  current_step integer not null default 0,
  next_run_at timestamptz,
  enrolled_by uuid references auth.users (id) on delete set null,
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sequence_id, email)
);
create index if not exists enrollments_org_sequence_idx
  on public.email_sequence_enrollments (organization_id, sequence_id, created_at desc);
create index if not exists enrollments_org_email_idx
  on public.email_sequence_enrollments (organization_id, lower(email));
create index if not exists enrollments_next_run_idx
  on public.email_sequence_enrollments (status, next_run_at) where status = 'active';
comment on table public.email_sequence_enrollments is 'Phase 11 per-recipient enrollment; one row per (org, sequence, email). Prevents duplicate enrollment.';

alter table public.email_sequence_enrollments enable row level security;
drop policy if exists enrollments_tenant_select on public.email_sequence_enrollments;
create policy enrollments_tenant_select on public.email_sequence_enrollments
  for select using (public.is_org_member(organization_id));
drop policy if exists enrollments_tenant_insert on public.email_sequence_enrollments;
create policy enrollments_tenant_insert on public.email_sequence_enrollments
  for insert with check (public.is_org_member(organization_id));
drop policy if exists enrollments_tenant_update on public.email_sequence_enrollments;
create policy enrollments_tenant_update on public.email_sequence_enrollments
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists enrollments_admin_delete on public.email_sequence_enrollments;
create policy enrollments_admin_delete on public.email_sequence_enrollments
  for delete using (public.is_org_admin(organization_id));
drop trigger if exists enrollments_tenant_identity_immutable on public.email_sequence_enrollments;
create trigger enrollments_tenant_identity_immutable
  before update on public.email_sequence_enrollments
  for each row execute function public.prevent_tenant_identity_change();

-- --------------------------------------------------------------------------
-- email_jobs — scheduled step executions (Phase 11 worker queue)
-- --------------------------------------------------------------------------
-- Add missing columns for Phase 11 execution
alter table public.email_jobs
  add column if not exists to_email text;
alter table public.email_jobs
  add column if not exists enrollment_id uuid references public.email_sequence_enrollments (id) on delete cascade;
alter table public.email_jobs
  add column if not exists template_id uuid references public.email_templates (id) on delete set null;
alter table public.email_jobs
  add column if not exists variables jsonb not null default '{}'::jsonb;
alter table public.email_jobs
  add column if not exists max_attempts integer not null default 5;
alter table public.email_jobs
  add column if not exists next_retry_at timestamptz;
alter table public.email_jobs
  add column if not exists locked_at timestamptz;
alter table public.email_jobs
  add column if not exists provider_message_id text;
alter table public.email_jobs
  add column if not exists provider text;
alter table public.email_jobs
  add column if not exists updated_at timestamptz not null default now();

-- Backfill to_email where possible (from enrollment or clients — best effort, app authoritative)
-- No irreversible data change — keep existing jobs with null to_email flagged by worker as invalid.

-- Replace global unique with per-org unique (tenant scoped idempotency like email_logs)
-- Keep the old constraint if it was global — we add a new partial unique and keep both.
create unique index if not exists email_jobs_org_idempotency_unique
  on public.email_jobs (organization_id, idempotency_key)
  where idempotency_key is not null;

-- Query indexes for worker
create index if not exists email_jobs_due_idx2
  on public.email_jobs (status, run_at) where status = 'queued';
create index if not exists email_jobs_org_enrollment_idx
  on public.email_jobs (organization_id, enrollment_id, created_at desc)
  where enrollment_id is not null;
create index if not exists email_jobs_next_retry_idx
  on public.email_jobs (status, next_retry_at) where next_retry_at is not null;

-- RLS already exists via 0004, reaffirm triggers
alter table public.email_jobs enable row level security;
drop trigger if exists email_jobs_tenant_identity_immutable on public.email_jobs;
create trigger email_jobs_tenant_identity_immutable
  before update on public.email_jobs
  for each row execute function public.prevent_tenant_identity_change();

-- --------------------------------------------------------------------------
-- email_preferences — opt-out / unsubscribe (Phase 11 suppression)
-- --------------------------------------------------------------------------
-- Already created in 0002 as (org_id, email) unique with opted_out bool.
-- Add indexes and RLS reaffirm.
create index if not exists preferences_org_email_idx
  on public.email_preferences (organization_id, lower(email));
alter table public.email_preferences enable row level security;
drop policy if exists preferences_tenant_select on public.email_preferences;
create policy preferences_tenant_select on public.email_preferences
  for select using (public.is_org_member(organization_id));
drop policy if exists preferences_tenant_insert on public.email_preferences;
create policy preferences_tenant_insert on public.email_preferences
  for insert with check (public.is_org_member(organization_id));
drop policy if exists preferences_tenant_update on public.email_preferences;
create policy preferences_tenant_update on public.email_preferences
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists preferences_admin_delete on public.email_preferences;
create policy preferences_admin_delete on public.email_preferences
  for delete using (public.is_org_admin(organization_id));
drop trigger if exists preferences_tenant_identity_immutable on public.email_preferences;
create trigger preferences_tenant_identity_immutable
  before update on public.email_preferences
  for each row execute function public.prevent_tenant_identity_change();

-- --------------------------------------------------------------------------
-- email_events — provider webhook table already exists; ensure index
-- --------------------------------------------------------------------------
create index if not exists events_org_log_idx
  on public.email_events (organization_id, email_log_id);

-- --------------------------------------------------------------------------
-- Single-flight claim for the email sequence worker (service_role only)
-- --------------------------------------------------------------------------
create or replace function public.claim_due_email_jobs(
  p_now timestamptz,
  p_lock_seconds integer,
  p_limit integer
)
returns setof public.email_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.email_jobs as job
  set status = 'sending',
      locked_at = p_now,
      attempts = job.attempts + 1,
      updated_at = p_now
  where job.id in (
    select candidate.id
    from public.email_jobs as candidate
    where candidate.status = 'queued'
      and candidate.run_at <= p_now
      and candidate.attempts < candidate.max_attempts
      and (candidate.locked_at is null
           or candidate.locked_at < p_now - make_interval(secs => p_lock_seconds))
    order by candidate.run_at asc
    limit p_limit
    for update skip locked
  )
  returning job.*;
end;
$$;
revoke all on function public.claim_due_email_jobs(timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_email_jobs(timestamptz, integer, integer)
  to service_role;
comment on function public.claim_due_email_jobs is 'Phase 11 single-flight claim for due sequence step jobs; SKIP LOCKED ensures duplicate workers never send duplicate emails.';
