-- Nibrexo OS AI — Migration 0005: RLS hardening and audit immutability
--
-- This is a corrective follow-up to 0004, not a replacement schema. PostgreSQL
-- policies are additive: the broad per-tenant UPDATE policy in 0004 would
-- otherwise also allow members to update approvals, task records and social
-- credential metadata. The application permission guard remains authoritative,
-- while these policies restore the intended database-level boundary for
-- sensitive records.

-- A tenant key must never be changed through an update. This prevents a row
-- from being moved into another organization by a caller who happens to belong
-- to both organizations.
create or replace function public.prevent_tenant_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable';
  end if;
  return new;
end;
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
    execute format('drop trigger if exists %I on public.%I', t || '_tenant_identity_immutable', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.prevent_tenant_identity_change()',
      t || '_tenant_identity_immutable', t
    );
  end loop;
end $$;

-- Audit events are append-only. Manager audit writes use INSERT; there is no
-- legitimate user-facing update or delete operation for an audit entry.
drop policy if exists activity_logs_tenant_update on public.activity_logs;
drop policy if exists activity_logs_admin_delete on public.activity_logs;

-- Approval decisions are elevated actions. Remove the broad member update
-- policy before adding the explicit owner/admin policy (policies are ORed).
drop policy if exists approvals_tenant_update on public.approvals;
drop policy if exists approvals_admin_delete on public.approvals;
drop policy if exists approvals_decide on public.approvals;
create policy approvals_decide on public.approvals
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- A task can only be created or updated by its requester, or by an org admin.
-- The immutability trigger above keeps its organization identity fixed.
drop policy if exists ai_tasks_tenant_insert on public.ai_tasks;
drop policy if exists ai_tasks_tenant_update on public.ai_tasks;
drop policy if exists ai_tasks_admin_delete on public.ai_tasks;
drop policy if exists ai_tasks_owner_update on public.ai_tasks;
-- Also drop the policies this migration itself creates, so the file is safe to
-- re-run (a SQL-Editor project where 0005 is applied twice, or after a partial
-- failure, must not fail with 42710 on an already-existing policy).
drop policy if exists ai_tasks_requester_insert on public.ai_tasks;
drop policy if exists ai_tasks_requester_update on public.ai_tasks;
create policy ai_tasks_requester_insert on public.ai_tasks
  for insert
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
create policy ai_tasks_requester_update on public.ai_tasks
  for update
  using (user_id = auth.uid() or public.is_org_admin(organization_id))
  with check (user_id = auth.uid() or public.is_org_admin(organization_id));

-- Integration credentials are never visible or mutable to regular members.
drop policy if exists social_credentials_tenant_select on public.social_credentials;
drop policy if exists social_credentials_tenant_insert on public.social_credentials;
drop policy if exists social_credentials_tenant_update on public.social_credentials;
-- Every policy this file creates is dropped first, so re-applying it (a second
-- SQL-Editor run, or a retry after a partial failure) cannot fail with 42710.
drop policy if exists social_credentials_admin_delete on public.social_credentials;
drop policy if exists social_credentials_admin_select on public.social_credentials;
drop policy if exists social_credentials_admin_insert on public.social_credentials;
drop policy if exists social_credentials_admin_update on public.social_credentials;
create policy social_credentials_admin_select on public.social_credentials
  for select using (public.is_org_admin(organization_id));
create policy social_credentials_admin_insert on public.social_credentials
  for insert with check (public.is_org_admin(organization_id));
create policy social_credentials_admin_update on public.social_credentials
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
create policy social_credentials_admin_delete on public.social_credentials
  for delete using (public.is_org_admin(organization_id));

-- Runtime settings carry configuration and therefore belong to owners/admins.
drop policy if exists settings_tenant_insert on public.settings;
drop policy if exists settings_tenant_update on public.settings;
drop policy if exists settings_admin_insert on public.settings;
drop policy if exists settings_admin_update on public.settings;
drop policy if exists settings_admin_delete on public.settings;
create policy settings_admin_insert on public.settings
  for insert with check (public.is_org_admin(organization_id));
create policy settings_admin_update on public.settings
  for update using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));
create policy settings_admin_delete on public.settings
  for delete using (public.is_org_admin(organization_id));
