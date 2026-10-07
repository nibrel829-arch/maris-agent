-- 0010_unified_inbox.sql — Phase 9 normalized social inbox.
-- Source: PDF #12 §§7, 11, 15–18. Official API capability review: docs/PHASE09_INBOX.md.
--
-- The conversations/messages tables from 0002 are retained and normalized in
-- place. New provider/account identity is explicit, message and participant
-- records are independently addressable, sync state is per connected account,
-- and reply attempts provide idempotency. A protected receipt table is reserved
-- for a future webhook integration; no webhook route is enabled in this phase.
-- No credentials or raw token material is stored in inbox rows.

-- Composite unique keys let PostgreSQL prove that every inbox child belongs to
-- the same tenant and social account as its parent (not just that UUIDs exist).
create unique index if not exists social_accounts_org_id_unique
  on public.social_accounts (organization_id, id);
create unique index if not exists social_accounts_org_id_platform_unique
  on public.social_accounts (organization_id, id, platform);
create unique index if not exists clients_org_id_unique
  on public.clients (organization_id, id);
create unique index if not exists conversations_org_id_unique
  on public.conversations (organization_id, id);

alter table public.conversations
  add column if not exists kind text not null default 'direct_message'
    check (kind in ('direct_message', 'comment_thread'));
alter table public.conversations
  add column if not exists last_message_preview text;
alter table public.conversations
  add column if not exists is_read boolean not null default true;
alter table public.conversations
  add column if not exists read_at timestamptz;
alter table public.conversations
  add column if not exists client_id uuid;
alter table public.conversations
  add column if not exists external_url text;
alter table public.conversations
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.conversations
  add column if not exists sync_error text;
alter table public.conversations alter column kind set default 'direct_message';

-- Provider thread IDs are account-scoped. Old null-account rows are preserved,
-- but all Phase 9 writes require an account and use this composite identity.
alter table public.conversations
  drop constraint if exists conversations_organization_id_platform_external_thread_id_key;
alter table public.conversations
  drop constraint if exists conversations_account_id_fkey;
update public.conversations c
set account_id = null
where c.account_id is not null
  and not exists (
    select 1 from public.social_accounts a
    where a.organization_id = c.organization_id
      and a.id = c.account_id
      and a.platform = c.platform
  );
alter table public.conversations
  drop constraint if exists conversations_client_org_fkey;
alter table public.conversations
  add constraint conversations_client_org_fkey
    foreign key (organization_id, client_id)
    references public.clients (organization_id, id)
    on delete set null (client_id);
alter table public.conversations
  drop constraint if exists conversations_account_org_platform_fkey;
alter table public.conversations
  add constraint conversations_account_org_platform_fkey
    foreign key (organization_id, account_id, platform)
    references public.social_accounts (organization_id, id, platform)
    on delete set null (account_id);
create unique index if not exists conversations_org_account_platform_thread_unique
  on public.conversations (organization_id, account_id, platform, external_thread_id);

create index if not exists conversations_inbox_org_latest_idx
  on public.conversations (organization_id, last_message_at desc nulls last, id desc);
create index if not exists conversations_inbox_account_idx
  on public.conversations (organization_id, account_id, is_read, last_message_at desc nulls last);
create index if not exists conversations_inbox_client_idx
  on public.conversations (organization_id, client_id)
  where client_id is not null;

create table if not exists public.inbox_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  external_participant_id text not null,
  display_name text not null,
  username text,
  avatar_url text,
  profile_url text,
  participant_type text not null default 'person'
    check (participant_type in ('person', 'account')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_participants_conversation_org_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete cascade,
  constraint inbox_participants_external_unique
    unique (conversation_id, external_participant_id)
);
create unique index if not exists inbox_participants_org_id_unique
  on public.inbox_participants (organization_id, id);
create index if not exists inbox_participants_org_conversation_idx
  on public.inbox_participants (organization_id, conversation_id);

alter table public.messages
  add column if not exists participant_id uuid;
alter table public.messages
  add column if not exists status text not null default 'received'
    check (status in ('received', 'sent', 'failed', 'unknown', 'deleted'));
alter table public.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.messages
  add column if not exists provider_url text;
alter table public.messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.messages alter column kind set default 'direct_message';
update public.messages set kind = 'direct_message' where kind = 'dm';
update public.messages set status = 'sent' where direction = 'outbound' and status = 'received';

alter table public.messages
  drop constraint if exists messages_organization_id_external_message_id_key;
alter table public.messages
  drop constraint if exists messages_conversation_id_fkey;
alter table public.messages
  drop constraint if exists messages_conversation_org_fkey;
alter table public.messages
  add constraint messages_conversation_org_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete cascade;
alter table public.messages
  drop constraint if exists messages_participant_org_fkey;
alter table public.messages
  add constraint messages_participant_org_fkey
    foreign key (organization_id, participant_id)
    references public.inbox_participants (organization_id, id)
    on delete set null (participant_id);
alter table public.messages
  drop constraint if exists messages_conversation_external_unique;
create unique index if not exists messages_conversation_external_unique
  on public.messages (conversation_id, external_message_id);

create index if not exists messages_inbox_org_conversation_time_idx
  on public.messages (organization_id, conversation_id, sent_at desc, id desc);
create index if not exists messages_inbox_unread_search_idx
  on public.messages (organization_id, sent_at desc);

create table if not exists public.inbox_sync_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  platform public.social_platform not null,
  cursor jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_poll_at timestamptz,
  lease_until timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_sync_account_org_platform_fkey
    foreign key (organization_id, account_id, platform)
    references public.social_accounts (organization_id, id, platform) on delete cascade,
  constraint inbox_sync_account_unique unique (organization_id, account_id)
);
create index if not exists inbox_sync_due_idx
  on public.inbox_sync_states (next_poll_at)
  where next_poll_at is not null;
create index if not exists inbox_sync_org_account_idx
  on public.inbox_sync_states (organization_id, platform, account_id);

create table if not exists public.inbox_reply_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  conversation_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'unknown')),
  provider_message_id text,
  error_code text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_reply_account_org_fkey
    foreign key (organization_id, account_id)
    references public.social_accounts (organization_id, id) on delete cascade,
  constraint inbox_reply_conversation_org_fkey
    foreign key (organization_id, conversation_id)
    references public.conversations (organization_id, id) on delete cascade,
  constraint inbox_reply_idempotency_unique
    unique (organization_id, idempotency_key)
);
create index if not exists inbox_reply_conversation_idx
  on public.inbox_reply_attempts (organization_id, conversation_id, created_at desc);
create unique index if not exists inbox_reply_single_unresolved_per_conversation
  on public.inbox_reply_attempts (organization_id, conversation_id)
  where status in ('pending', 'unknown');

create table if not exists public.inbox_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  provider_event_key text not null,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbox_webhook_account_org_fkey
    foreign key (organization_id, account_id)
    references public.social_accounts (organization_id, id) on delete cascade,
  constraint inbox_webhook_event_unique
    unique (account_id, provider_event_key)
);
create index if not exists inbox_webhook_org_received_idx
  on public.inbox_webhook_receipts (organization_id, received_at desc);

-- Tenant identity immutability plus relationship consistency protect against
-- an authenticated user who belongs to multiple organizations moving rows.
drop trigger if exists inbox_participants_tenant_identity_immutable on public.inbox_participants;
create trigger inbox_participants_tenant_identity_immutable
  before update on public.inbox_participants
  for each row execute function public.prevent_tenant_identity_change();
drop trigger if exists inbox_sync_states_tenant_identity_immutable on public.inbox_sync_states;
create trigger inbox_sync_states_tenant_identity_immutable
  before update on public.inbox_sync_states
  for each row execute function public.prevent_tenant_identity_change();
drop trigger if exists inbox_reply_attempts_tenant_identity_immutable on public.inbox_reply_attempts;
create trigger inbox_reply_attempts_tenant_identity_immutable
  before update on public.inbox_reply_attempts
  for each row execute function public.prevent_tenant_identity_change();
drop trigger if exists inbox_webhook_receipts_tenant_identity_immutable on public.inbox_webhook_receipts;
create trigger inbox_webhook_receipts_tenant_identity_immutable
  before update on public.inbox_webhook_receipts
  for each row execute function public.prevent_tenant_identity_change();

-- The 0004 generic policies already protect conversations/messages by tenant.
-- Replace their inserts with admin-only writes: provider ingestors use the
-- server-only service role after an authorized request or verified webhook.
drop policy if exists conversations_tenant_insert on public.conversations;
create policy conversations_tenant_insert on public.conversations
  for insert with check (public.is_org_admin(organization_id));
drop policy if exists messages_tenant_insert on public.messages;
create policy messages_tenant_insert on public.messages
  for insert with check (public.is_org_admin(organization_id));
drop policy if exists messages_tenant_update on public.messages;
create policy messages_tenant_update on public.messages
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

alter table public.inbox_participants enable row level security;
drop policy if exists inbox_participants_tenant_select on public.inbox_participants;
create policy inbox_participants_tenant_select on public.inbox_participants
  for select using (public.is_org_member(organization_id));
drop policy if exists inbox_participants_tenant_insert on public.inbox_participants;
create policy inbox_participants_tenant_insert on public.inbox_participants
  for insert with check (public.is_org_admin(organization_id));
drop policy if exists inbox_participants_tenant_update on public.inbox_participants;
create policy inbox_participants_tenant_update on public.inbox_participants
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
drop policy if exists inbox_participants_admin_delete on public.inbox_participants;
create policy inbox_participants_admin_delete on public.inbox_participants
  for delete using (public.is_org_admin(organization_id));

alter table public.inbox_sync_states enable row level security;
drop policy if exists inbox_sync_states_tenant_select on public.inbox_sync_states;
create policy inbox_sync_states_tenant_select on public.inbox_sync_states
  for select using (public.is_org_member(organization_id));
drop policy if exists inbox_sync_states_tenant_insert on public.inbox_sync_states;
create policy inbox_sync_states_tenant_insert on public.inbox_sync_states
  for insert with check (public.is_org_admin(organization_id));
drop policy if exists inbox_sync_states_tenant_update on public.inbox_sync_states;
create policy inbox_sync_states_tenant_update on public.inbox_sync_states
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
drop policy if exists inbox_sync_states_admin_delete on public.inbox_sync_states;
create policy inbox_sync_states_admin_delete on public.inbox_sync_states
  for delete using (public.is_org_admin(organization_id));

alter table public.inbox_reply_attempts enable row level security;
drop policy if exists inbox_reply_attempts_tenant_select on public.inbox_reply_attempts;
create policy inbox_reply_attempts_tenant_select on public.inbox_reply_attempts
  for select using (public.is_org_member(organization_id));
drop policy if exists inbox_reply_attempts_tenant_insert on public.inbox_reply_attempts;
create policy inbox_reply_attempts_tenant_insert on public.inbox_reply_attempts
  for insert with check (public.is_org_admin(organization_id));
drop policy if exists inbox_reply_attempts_tenant_update on public.inbox_reply_attempts;
create policy inbox_reply_attempts_tenant_update on public.inbox_reply_attempts
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
drop policy if exists inbox_reply_attempts_admin_delete on public.inbox_reply_attempts;
create policy inbox_reply_attempts_admin_delete on public.inbox_reply_attempts
  for delete using (public.is_org_admin(organization_id));

alter table public.inbox_webhook_receipts enable row level security;
drop policy if exists inbox_webhook_receipts_tenant_select on public.inbox_webhook_receipts;
create policy inbox_webhook_receipts_tenant_select on public.inbox_webhook_receipts
  for select using (public.is_org_admin(organization_id));
drop policy if exists inbox_webhook_receipts_tenant_insert on public.inbox_webhook_receipts;
create policy inbox_webhook_receipts_tenant_insert on public.inbox_webhook_receipts
  for insert with check (public.is_org_admin(organization_id));
drop policy if exists inbox_webhook_receipts_tenant_update on public.inbox_webhook_receipts;
create policy inbox_webhook_receipts_tenant_update on public.inbox_webhook_receipts
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
drop policy if exists inbox_webhook_receipts_admin_delete on public.inbox_webhook_receipts;
create policy inbox_webhook_receipts_admin_delete on public.inbox_webhook_receipts
  for delete using (public.is_org_admin(organization_id));

-- `inbox_sync_states` and all external send attempts are server-managed only.
-- The worker RPCs are not exposed to anon/authenticated roles; state changes
-- use the existing server-only service-role repository and are rechecked by
-- the service layer before any provider call.