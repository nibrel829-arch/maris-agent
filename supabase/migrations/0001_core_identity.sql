-- Nibrexo OS AI — Migration 0001: Identity, tenancy and audit
-- Source: PDF #05 §3 Core Tables, PDF #12 §7 Database Master Scope,
--         PDF #11 §5 Authorization & Multi-Tenant Security

create extension if not exists "pgcrypto";

-- organizations ------------------------------------------------------------
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- profiles -----------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- memberships --------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_role') then
    create type public.org_role as enum ('owner', 'admin', 'member', 'client');
  end if;
end $$;

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx on public.memberships (organization_id);

-- activity_logs ------------------------------------------------------------
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_org_created_idx
  on public.activity_logs (organization_id, created_at desc);
create index if not exists activity_logs_action_idx on public.activity_logs (action);

-- notifications ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_severity') then
    create type public.notification_severity as enum ('info', 'warning', 'error');
  end if;
end $$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  body text not null default '',
  severity public.notification_severity not null default 'info',
  read boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notifications_org_idx
  on public.notifications (organization_id, created_at desc);

-- organization settings ----------------------------------------------------
create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  category text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, category, key)
);

-- Helper: is the current user a member of this organization?
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.org_role_of(org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.memberships m
  where m.organization_id = org and m.user_id = auth.uid()
  limit 1;
$$;
