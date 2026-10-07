-- Nibrexo OS AI — Migration 0008: Social account connections (Phase 7)
-- Source: Phase 7 build (PDF #09 social adapters, PDF #12 §2 Social).
--
-- Additive only, re-runnable:
--  * `social_oauth_states` — single-use OAuth `state` values for the connect
--    flow. Only the sha256 hash of each state is stored; the raw value lives
--    in the provider redirect for minutes and is never persisted. `payload`
--    may hold encrypted interim data (Facebook Page selection) and must never
--    hold plaintext secrets — enforced by the application layer, which is the
--    only writer (service role).
--  * `social_credentials` gains encrypted token columns. Tokens are
--    AES-256-GCM ciphertext produced by the application; the database never
--    sees plaintext. `credential_ref` keeps its NOT NULL contract and now
--    records the encryption key version (e.g. `v1`) so a future rotation can
--    tell keys apart.
--  * `social_accounts` gains `connected_by` (who completed OAuth) and
--    `last_error` (safe, user-facing connection failure text).
--
-- RLS: the new states table follows the 0004 tenant pattern (members manage
-- their own organization's states, deletes are owner/admin-only) plus the
-- 0005 tenant-identity immutability trigger. `social_accounts` keeps its 0004
-- tenant policies and `social_credentials` keeps its 0005 admin-only
-- policies; the new columns inherit them automatically.

-- OAuth states -------------------------------------------------------------
create table if not exists public.social_oauth_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  platform public.social_platform not null,
  state_hash text not null unique,
  redirect_uri text not null,
  requested_by uuid,
  payload jsonb,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_oauth_states_org_idx
  on public.social_oauth_states (organization_id, platform);

alter table public.social_oauth_states enable row level security;

drop policy if exists social_oauth_states_tenant_select on public.social_oauth_states;
create policy social_oauth_states_tenant_select on public.social_oauth_states
  for select using (public.is_org_member(organization_id));

drop policy if exists social_oauth_states_tenant_insert on public.social_oauth_states;
create policy social_oauth_states_tenant_insert on public.social_oauth_states
  for insert with check (public.is_org_member(organization_id));

drop policy if exists social_oauth_states_tenant_update on public.social_oauth_states;
create policy social_oauth_states_tenant_update on public.social_oauth_states
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists social_oauth_states_admin_delete on public.social_oauth_states;
create policy social_oauth_states_admin_delete on public.social_oauth_states
  for delete using (public.is_org_admin(organization_id));

drop trigger if exists social_oauth_states_tenant_identity_immutable on public.social_oauth_states;
create trigger social_oauth_states_tenant_identity_immutable
  before update on public.social_oauth_states
  for each row execute function public.prevent_tenant_identity_change();

-- Encrypted credential material --------------------------------------------
alter table public.social_credentials
  add column if not exists access_token_encrypted text;
alter table public.social_credentials
  add column if not exists refresh_token_encrypted text;
alter table public.social_credentials
  add column if not exists token_type text not null default 'bearer';
alter table public.social_credentials
  add column if not exists refresh_expires_at timestamptz;
alter table public.social_credentials
  add column if not exists last_refreshed_at timestamptz;

-- Account attribution and safe error state ---------------------------------
alter table public.social_accounts
  add column if not exists connected_by uuid;
alter table public.social_accounts
  add column if not exists last_error text;
