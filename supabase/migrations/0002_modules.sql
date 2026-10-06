-- Nibrexo OS AI — Migration 0002: CRM, content, social, email
-- Source: PDF #05 §4-§7, PDF #09 §5, PDF #10 §17

-- CRM ----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'client_status') then
    create type public.client_status as enum ('lead', 'qualified', 'active', 'paused', 'churned');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_stage') then
    create type public.lead_stage as enum ('identified', 'researched', 'contacted', 'qualified', 'disqualified', 'converted');
  end if;
  if not exists (select 1 from pg_type where typname = 'content_status') then
    create type public.content_status as enum ('DRAFT','VALIDATING','READY','SCHEDULED','PUBLISHING','PUBLISHED','PARTIAL','FAILED','CANCELLED');
  end if;
  if not exists (select 1 from pg_type where typname = 'email_status') then
    create type public.email_status as enum ('DRAFT','PENDING_APPROVAL','APPROVED','QUEUED','SENDING','SENT','DELIVERED','BOUNCED','FAILED','CANCELLED');
  end if;
  if not exists (select 1 from pg_type where typname = 'social_platform') then
    create type public.social_platform as enum ('tiktok','youtube','pinterest','linkedin','instagram','facebook','contra');
  end if;
  if not exists (select 1 from pg_type where typname = 'connection_status') then
    create type public.connection_status as enum ('connected','reconnect_required','disconnected','pending');
  end if;
  if not exists (select 1 from pg_type where typname = 'sequence_status') then
    create type public.sequence_status as enum ('draft','active','paused','completed');
  end if;
end $$;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  company text,
  email text,
  status public.client_status not null default 'lead',
  tags text[] not null default '{}',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_org_idx on public.clients (organization_id, created_at desc);
create index if not exists clients_status_idx on public.clients (organization_id, status);

create table if not exists public.client_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  kind text not null,
  subject text not null,
  body text,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_activity_client_idx on public.client_activity (client_id, created_at desc);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  name text not null,
  company text,
  email text,
  source text not null,
  stage public.lead_stage not null default 'identified',
  qualification_score integer not null default 0 check (qualification_score between 0 and 100),
  qualification_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_org_idx on public.leads (organization_id, created_at desc);
create index if not exists leads_stage_idx on public.leads (organization_id, stage);

-- Content ------------------------------------------------------------------
create table if not exists public.media_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists media_files_org_idx on public.media_files (organization_id, created_at desc);

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  caption text,
  body text,
  status public.content_status not null default 'DRAFT',
  platforms text[] not null default '{}',
  media_url text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists content_items_org_idx on public.content_items (organization_id, created_at desc);
create index if not exists content_items_status_idx on public.content_items (organization_id, status);

create table if not exists public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  platform text,
  run_at timestamptz not null,
  timezone text not null default 'UTC',
  idempotency_key text not null unique,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scheduled_jobs_due_idx on public.scheduled_jobs (status, run_at);

-- Social -------------------------------------------------------------------
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  platform public.social_platform not null,
  external_account_id text not null,
  name text not null,
  status public.connection_status not null default 'pending',
  capabilities jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, platform, external_account_id)
);
create index if not exists social_accounts_org_idx on public.social_accounts (organization_id);

-- Credentials are referenced here, never stored in the browser path.
create table if not exists public.social_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null references public.social_accounts (id) on delete cascade,
  credential_ref text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid references public.social_accounts (id) on delete set null,
  platform public.social_platform not null,
  external_thread_id text not null,
  participant_name text,
  status text not null default 'open',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, platform, external_thread_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  external_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  kind text not null default 'dm',
  body text,
  sent_at timestamptz,
  ai_draft text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_message_id)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, sent_at desc);

-- Email --------------------------------------------------------------------
create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  category text not null,
  subject text not null,
  body text not null,
  variables text[] not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_templates_org_idx on public.email_templates (organization_id, created_at desc);

create table if not exists public.email_sequences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  trigger text not null,
  steps jsonb not null default '[]'::jsonb,
  stop_conditions text[] not null default '{}',
  status public.sequence_status not null default 'draft',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id uuid not null references public.email_sequences (id) on delete cascade,
  position integer not null,
  delay_days integer not null default 0,
  template_id uuid references public.email_templates (id) on delete set null,
  subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, position)
);

create table if not exists public.email_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sequence_id uuid references public.email_sequences (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  step_id uuid references public.email_steps (id) on delete set null,
  idempotency_key text not null unique,
  run_at timestamptz not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_jobs_due_idx on public.email_jobs (status, run_at);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  template_id uuid references public.email_templates (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  status public.email_status not null default 'DRAFT',
  provider_message_id text,
  error_message text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists email_logs_org_idx on public.email_logs (organization_id, created_at desc);
create index if not exists email_logs_status_idx on public.email_logs (organization_id, status);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email_log_id uuid references public.email_logs (id) on delete cascade,
  provider text,
  provider_event_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.email_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);
