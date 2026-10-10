-- Nibrexo OS AI — Migration 0013: Manager execution, truthful statuses, deliverables (Phase 17)
--
-- Additive only. Existing rows, policies and data are not modified.
--
--  1. manager_task_state gains NEEDS_INPUT (paused on a user answer) and
--     BLOCKED (cannot proceed: permission or unconfigured provider).
--  2. manager_artifacts stores generated deliverables (DOCX/CSV/HTML/TXT) with
--     organization ownership and assignment linkage. Bytes are kept as base64
--     text so the same row works through PostgREST and the memory backend.
--
-- Safe to re-run: ADD VALUE IF NOT EXISTS, IF NOT EXISTS for tables/indexes,
-- DROP POLICY IF EXISTS before CREATE POLICY.

alter type public.manager_task_state add value if not exists 'NEEDS_INPUT';
alter type public.manager_task_state add value if not exists 'BLOCKED';

create table if not exists public.manager_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  step_id text,
  kind text not null,
  format text not null check (format in ('docx', 'csv', 'html', 'txt')),
  title text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes >= 0 and size_bytes <= 10485760),
  sha256 text not null check (char_length(sha256) = 64),
  content_base64 text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists manager_artifacts_org_idx on public.manager_artifacts (organization_id, created_at desc);
create index if not exists manager_artifacts_task_idx on public.manager_artifacts (task_id);

alter table public.manager_artifacts enable row level security;

drop trigger if exists manager_artifacts_tenant_identity_immutable on public.manager_artifacts;
create trigger manager_artifacts_tenant_identity_immutable
  before update on public.manager_artifacts
  for each row execute function public.prevent_tenant_identity_change();

-- Read: any member of the organization (the application further restricts
-- download to roles with the `ai` view permission and excludes the client role).
drop policy if exists manager_artifacts_tenant_select on public.manager_artifacts;
create policy manager_artifacts_tenant_select on public.manager_artifacts
  for select using (public.is_org_member(organization_id));

-- Write: members create artifacts for their own organization's tasks.
drop policy if exists manager_artifacts_member_insert on public.manager_artifacts;
create policy manager_artifacts_member_insert on public.manager_artifacts
  for insert with check (public.is_org_member(organization_id));

-- Delete: owners and admins only (used when a resumed task regenerates files).
drop policy if exists manager_artifacts_admin_delete on public.manager_artifacts;
create policy manager_artifacts_admin_delete on public.manager_artifacts
  for delete using (public.is_org_admin(organization_id));

-- No update policy: an artifact is immutable once written.
