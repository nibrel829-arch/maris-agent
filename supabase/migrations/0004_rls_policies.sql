-- Nibrexo OS AI — Migration 0004: Row Level Security
-- Source: PDF #05 §9, PDF #11 §5, PDF #12 §17 Security Master Rules
--
-- Principles enforced here:
--  * Every organization sees only its own records.
--  * RLS is the database boundary; server-side authorization remains
--    authoritative for role/action decisions.
--  * Destructive actions are restricted to owner/admin.
--  * The AI agent uses the same boundaries as users (PDF #12 §15).

-- Restrict destructive operations to owner / admin.
create or replace function public.is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_role_of(org) in ('owner', 'admin');
$$;

do $$
declare
  tenant_tables text[] := array[
    'activity_logs','notifications','settings',
    'clients','client_activity','leads',
    'media_files','content_items','scheduled_jobs',
    'social_accounts','social_credentials','conversations','messages',
    'email_templates','email_sequences','email_steps','email_jobs',
    'email_logs','email_events','email_preferences',
    'ai_tasks','ai_actions','ai_memory','approvals',
    'research_briefs','product_concepts','visual_concepts',
    'campaign_plans','social_plans','community_plans','quality_reports'
  ];
  t text;
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'drop policy if exists %I on public.%I', t || '_tenant_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.is_org_member(organization_id))',
      t || '_tenant_select', t);

    execute format(
      'drop policy if exists %I on public.%I', t || '_tenant_insert', t);
    execute format(
      'create policy %I on public.%I for insert with check (public.is_org_member(organization_id))',
      t || '_tenant_insert', t);

    execute format(
      'drop policy if exists %I on public.%I', t || '_tenant_update', t);
    execute format(
      'create policy %I on public.%I for update using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))',
      t || '_tenant_update', t);

    execute format(
      'drop policy if exists %I on public.%I', t || '_admin_delete', t);
    execute format(
      'create policy %I on public.%I for delete using (public.is_org_admin(organization_id))',
      t || '_admin_delete', t);
  end loop;
end $$;

-- Approvals: deciding an approval is an elevated action.
alter table public.approvals enable row level security;
drop policy if exists approvals_decide on public.approvals;
create policy approvals_decide on public.approvals
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Task lifecycle: only the requesting user or an admin may cancel a task.
drop policy if exists ai_tasks_owner_update on public.ai_tasks;
create policy ai_tasks_owner_update on public.ai_tasks
  for update using (user_id = auth.uid() or public.is_org_admin(organization_id))
  with check (user_id = auth.uid() or public.is_org_admin(organization_id));

-- Organizations ----------------------------------------------------------
alter table public.organizations enable row level security;
drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations
  for select using (exists (
    select 1 from public.memberships m
    where m.organization_id = organizations.id and m.user_id = auth.uid()
  ));

drop policy if exists organizations_admin_update on public.organizations;
create policy organizations_admin_update on public.organizations
  for update using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- Memberships ------------------------------------------------------------
alter table public.memberships enable row level security;
drop policy if exists memberships_member_select on public.memberships;
create policy memberships_member_select on public.memberships
  for select using (public.is_org_member(organization_id));

drop policy if exists memberships_admin_write on public.memberships;
create policy memberships_admin_write on public.memberships
  for all using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- Profiles ---------------------------------------------------------------
alter table public.profiles enable row level security;
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or exists (
    select 1 from public.memberships a
    join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and b.user_id = profiles.id
  ));

drop policy if exists profiles_self_write on public.profiles;
create policy profiles_self_write on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Social credentials are never readable by client roles.
drop policy if exists social_credentials_admin_select on public.social_credentials;
create policy social_credentials_admin_select on public.social_credentials
  for select using (public.is_org_admin(organization_id));
