-- 0009_publish_jobs.sql — Phase 8 publishing pipeline.
--
-- One row per (content × social account) publish target. The row is BOTH the
-- scheduled job and the per-target execution record: immediate publishes are
-- rows with run_at ~= now, scheduled publishes are rows with a future run_at,
-- and provider-native schedules (YouTube publishAt, Facebook
-- scheduled_publish_time) are rows parked in 'scheduled' until the provider
-- goes live and the sweeper verifies the result.
--
-- Status lifecycle (enforced by CHECK; transitions happen in the service):
--   queued -> publishing -> verifying -> published
--                                  \-> failed | unknown
--   queued -> publishing -> scheduled -> published | failed   (provider-native)
--   queued | verifying | scheduled -> cancelled
-- Terminal: published, failed, unknown, cancelled.
--
-- `verification` records HOW a published job was confirmed, because "the API
-- returned 200" is not proof of publication:
--   read_back          — the provider object was read back (id match)
--   provider_reference — the provider returned a durable id but offers no
--                        read-back under our scopes (LinkedIn member posts:
--                        r_member_social is a restricted product)
--
-- `payload` is the frozen publish snapshot (caption, media pointer, per-target
-- options) taken at creation, so later content edits never change a scheduled
-- post. `provider_payload` carries interim NON-SECRET provider state needed to
-- continue across sweeps (container ids, publish ids). Upload URLs, tokens and
-- secrets are never stored here.
--
-- Duplicate-publication protection:
--   1. `idempotency_key` is globally unique; the service derives it
--      deterministically from (org, content, account, run_at, payload hash),
--      so a retried request resolves to the existing row instead of publishing
--      twice.
--   2. `claim_due_publish_jobs()` hands each due row to exactly one sweeper
--      via SELECT ... FOR UPDATE SKIP LOCKED plus a lock lease (`locked_at`).
-- Crash-window honesty: if a worker dies after the provider accepted a submit
-- but before the row is updated, the reclaimed row re-submits. Providers here
-- offer no publish-side idempotency keys, so at-least-once delivery in that
-- millisecond window is disclosed, not hidden.

create table if not exists public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_id uuid not null references public.content_items (id) on delete cascade,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  platform public.social_platform not null,
  status text not null default 'queued'
    check (status in (
      'queued', 'publishing', 'verifying', 'scheduled',
      'published', 'failed', 'unknown', 'cancelled'
    )),
  verification text null
    check (verification is null or verification in ('read_back', 'provider_reference')),
  run_at timestamptz not null default now(),
  timezone text not null default 'UTC',
  idempotency_key text not null unique,
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  provider_ref text,
  provider_payload jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  next_poll_at timestamptz,
  locked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists publish_jobs_due_idx
  on public.publish_jobs (status, run_at, next_poll_at);
create index if not exists publish_jobs_content_idx
  on public.publish_jobs (organization_id, content_id, created_at desc);
create index if not exists publish_jobs_account_idx
  on public.publish_jobs (organization_id, account_id, created_at desc);

-- RLS: same shape as the other tenant tables (0004/0008). Members work their
-- own org's queue; only owners/admins can delete history. Actual publish
-- authorization (social.publish) is enforced in the service layer.
alter table public.publish_jobs enable row level security;

drop policy if exists publish_jobs_tenant_select on public.publish_jobs;
create policy publish_jobs_tenant_select on public.publish_jobs
  for select using (public.is_org_member(organization_id));

drop policy if exists publish_jobs_tenant_insert on public.publish_jobs;
create policy publish_jobs_tenant_insert on public.publish_jobs
  for insert with check (public.is_org_member(organization_id));

drop policy if exists publish_jobs_tenant_update on public.publish_jobs;
create policy publish_jobs_tenant_update on public.publish_jobs
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists publish_jobs_admin_delete on public.publish_jobs;
create policy publish_jobs_admin_delete on public.publish_jobs
  for delete using (public.is_org_admin(organization_id));

drop trigger if exists publish_jobs_tenant_identity_immutable on public.publish_jobs;
create trigger publish_jobs_tenant_identity_immutable
  before update on public.publish_jobs
  for each row execute function public.prevent_tenant_identity_change();

-- Single-flight claim for the publish sweeper. Returns the claimed rows with
-- attempts already bumped and the lock lease set. SKIP LOCKED keeps parallel
-- sweepers (overlapping cron ticks, retries) from executing the same job.
-- Reclaimable: due queued rows, due verifying/scheduled polls, and rows whose
-- worker died mid-step (publishing with an expired lease).
create or replace function public.claim_due_publish_jobs(
  p_now timestamptz,
  p_lock_seconds integer,
  p_limit integer
)
returns setof public.publish_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.publish_jobs as job
  set status = case when job.status = 'queued' then 'publishing' else job.status end,
      locked_at = p_now,
      attempts = job.attempts + 1,
      updated_at = p_now
  where job.id in (
    select candidate.id
    from public.publish_jobs as candidate
    where (
      (candidate.status = 'queued' and candidate.run_at <= p_now)
      or (candidate.status = 'verifying'
          and candidate.next_poll_at is not null
          and candidate.next_poll_at <= p_now)
      or (candidate.status = 'scheduled'
          and candidate.next_poll_at is not null
          and candidate.next_poll_at <= p_now)
      or (candidate.status = 'publishing'
          and candidate.locked_at is not null
          and candidate.locked_at < p_now - make_interval(secs => p_lock_seconds))
    )
    and (candidate.locked_at is null
         or candidate.locked_at < p_now - make_interval(secs => p_lock_seconds))
    and candidate.attempts < candidate.max_attempts
    order by coalesce(candidate.next_poll_at, candidate.run_at) asc
    limit p_limit
    for update skip locked
  )
  returning job.*;
end;
$$;

-- The claim function bypasses RLS by design (the sweeper runs with the
-- service role and CRON_SECRET); it must never be callable by app users.
revoke all on function public.claim_due_publish_jobs(timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_publish_jobs(timestamptz, integer, integer)
  to service_role;
