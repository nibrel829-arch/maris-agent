-- Nibrexo OS AI — one-time owner bootstrap for the single Nibrexo organization.
--
-- WHERE TO RUN THIS
--   Supabase Dashboard -> SQL Editor (runs as `postgres`), or
--   `psql "$DATABASE_URL"` as the project owner / service_role.
--
--   This is deliberately NOT a migration: `supabase db push` must never grant
--   an owner role, and this file is not picked up automatically (it lives in
--   `supabase/scripts/`, not `supabase/migrations/`). Running it twice is safe.
--
-- WHY THIS EXISTS
--   Supabase Auth can sign a user in while no `public.memberships` row exists,
--   which makes `resolveActor()` (src/server/auth/actor.ts) return
--   NO_ORGANIZATION: "Your account is not a member of any organization."
--   The signed-in user cannot fix this themselves: policy
--   `memberships_admin_write` (0004_rls_policies.sql) only lets an *existing*
--   owner/admin of the same organization write membership rows. Bootstrapping
--   the first owner is therefore an operator action — never a public signup.
--
-- GUARANTEES
--   * creates at most ONE organization, ONE profile row and ONE membership row;
--   * never creates or modifies an auth user (an invite must already exist);
--   * never deletes or downgrades anything (an existing owner stays owner);
--   * refuses to guess when the project holds several organizations and none
--     uniquely matches the configured slug;
--   * does not weaken RLS: it runs as an administrator, so every policy in
--     0004/0005 remains exactly as deployed.
--
-- CONFIGURE: edit the values below, then run the whole file.
-- (`npm run auth:provision -- --email=<owner email> --print-sql` writes this
--  file out with the values already filled in.)
--
-- PREREQUISITE
--   Migrations 0001-0005 must already be applied to this project. The preflight
--   block below verifies that and stops with an actionable message instead of a
--   bare `42704: type "public.org_role" does not exist`. If it stops: apply the
--   migrations (never create the type by hand) — see
--   `supabase/scripts/diagnose_schema.sql` and `docs/SUPABASE_VERIFICATION.md`.

-- ---------------------------------------------------------------------------
-- PREFLIGHT (read-only): confirm the repository schema exists before touching
-- anything. It reads catalogs only — no type or table is created, altered or
-- dropped here, and the enum stays authoritative for `v_role` below.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regtype('public.org_role') is null then
    v_missing := array_append(v_missing, 'type public.org_role  (supabase/migrations/0001_core_identity.sql)');
  end if;
  if to_regclass('public.organizations') is null then
    v_missing := array_append(v_missing, 'table public.organizations  (supabase/migrations/0001_core_identity.sql)');
  end if;
  if to_regclass('public.profiles') is null then
    v_missing := array_append(v_missing, 'table public.profiles  (supabase/migrations/0001_core_identity.sql)');
  end if;
  if to_regclass('public.memberships') is null then
    v_missing := array_append(v_missing, 'table public.memberships  (supabase/migrations/0001_core_identity.sql)');
  end if;

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception E'Nibrexo schema is not fully applied to this project, so the owner bootstrap cannot run yet.\nMissing:\n  - %\nFix: apply supabase/migrations 0001 -> 0005 in order (supabase db push, or paste each file into the SQL Editor in order), then re-run this file unchanged.\nDo not create these objects by hand. Nothing was created or modified by this run.',
      array_to_string(v_missing, E'\n  - ');
  end if;
end $$;

do $$
declare
  -- ------------------------------------------------------------------ config
  v_owner_email text := 'CHANGE_ME_OWNER_EMAIL';            -- @nibrexo:owner-email
  v_owner_id    uuid := null;                               -- @nibrexo:owner-id
  v_org_name    text := 'Nibrexo';                          -- @nibrexo:org-name
  v_org_slug    text := 'nibrexo';                          -- @nibrexo:org-slug
  v_role        public.org_role := 'owner';                 -- @nibrexo:role
  v_full_name   text := null;                               -- @nibrexo:full-name
  -- ------------------------------------------------------------------------
  v_user_id          uuid;
  v_user_matches     int;
  v_org_id           uuid;
  v_org_matches      int;
  v_org_total        int;
  v_previous_role    public.org_role;
  v_membership_id    uuid;
  v_membership_state text := 'unchanged';
  v_profile_created  boolean := false;
  v_org_created      boolean := false;
begin
  -- 0. Only a project administrator may bootstrap an owner. A PostgREST call
  --    with an `anon` or `authenticated` JWT is rejected here.
  if current_user not in ('postgres', 'supabase_admin', 'dashboard_user', 'service_role') then
    raise exception
      'provision_owner.sql must be executed by a project administrator (SQL editor or service role); current role is %',
      current_user;
  end if;

  if v_role not in ('owner', 'admin') then
    raise exception 'v_role must be ''owner'' or ''admin'' (got %)', v_role;
  end if;

  if v_org_slug !~ '^[a-z0-9][a-z0-9-]{1,60}$' then
    raise exception
      'v_org_slug "%" violates the organizations_slug_check constraint (0001_core_identity.sql)',
      v_org_slug;
  end if;

  -- 1. Resolve the existing Supabase Auth user. This script never creates one.
  if v_owner_id is not null then
    select u.id into v_user_id from auth.users u where u.id = v_owner_id;
    v_user_matches := case when v_user_id is null then 0 else 1 end;
  else
    select count(*) into v_user_matches
      from auth.users u where lower(u.email) = lower(v_owner_email);
    if v_user_matches = 1 then
      select u.id into v_user_id
        from auth.users u where lower(u.email) = lower(v_owner_email);
    end if;
  end if;

  if v_user_matches = 0 then
    raise exception
      'No Supabase Auth user matches the configured identity. Invite/create that user in Authentication -> Users first, then re-run this file. No account is created here.';
  elsif v_user_matches > 1 then
    raise exception
      'Several auth users match the configured identity (% matches). Set v_owner_id to the exact auth.users.id and re-run.',
      v_user_matches;
  end if;

  -- 2. Reuse the existing organization when there is exactly one; create the
  --    single intended one only when the project has none.
  select count(*) into v_org_total from public.organizations;

  if v_org_total = 0 then
    insert into public.organizations (name, slug)
      values (v_org_name, v_org_slug)
      returning id into v_org_id;
    v_org_created := true;
    raise notice 'Created organization "%" (%).', v_org_slug, v_org_id;
  elsif v_org_total = 1 then
    select o.id into v_org_id from public.organizations o limit 1;
    raise notice 'Reusing the single existing organization (%).', v_org_id;
  else
    select count(*) into v_org_matches from public.organizations o where o.slug = v_org_slug;
    if v_org_matches <> 1 then
      raise exception
        'This project has % organizations and none uniquely matches slug "%". Refusing to guess; pass the exact Nibrexo slug as v_org_slug. No organization was created.',
        v_org_total, v_org_slug;
    end if;
    select o.id into v_org_id from public.organizations o where o.slug = v_org_slug;
    raise notice 'Reusing organization "%" (%).', v_org_slug, v_org_id;
  end if;

  -- 3. Profile row (presentation data; never overwritten when it exists).
  insert into public.profiles (id, full_name)
    values (v_user_id, v_full_name)
    on conflict (id) do nothing;
  v_profile_created := found;

  -- 4. Membership row: create it, promote it, or leave it exactly as it is.
  v_previous_role := null;
  select m.role into v_previous_role
    from public.memberships m
    where m.organization_id = v_org_id and m.user_id = v_user_id;

  if v_previous_role is null then
    insert into public.memberships (organization_id, user_id, role)
      values (v_org_id, v_user_id, v_role)
      returning id into v_membership_id;
    v_membership_state := format('created as %s', v_role);
  elsif v_previous_role = v_role then
    select m.id into v_membership_id
      from public.memberships m
      where m.organization_id = v_org_id and m.user_id = v_user_id;
    v_membership_state := format('already %s (unchanged)', v_previous_role);
  elsif v_previous_role = 'owner' then
    select m.id into v_membership_id
      from public.memberships m
      where m.organization_id = v_org_id and m.user_id = v_user_id;
    v_membership_state := format('kept %s (no downgrade to %s)', v_previous_role, v_role);
  else
    update public.memberships m
      set role = v_role
      where m.organization_id = v_org_id and m.user_id = v_user_id
      returning m.id into v_membership_id;
    v_membership_state := format('promoted %s -> %s', v_previous_role, v_role);
  end if;

  raise notice 'Owner bootstrap complete — organization % (created: %), profile created: %, membership %: %, membership id %.',
    v_org_id, v_org_created, v_profile_created, v_user_id, v_membership_state, v_membership_id;

  raise notice 'Organization total: % — exactly one is intended; duplicate organizations are never created by this script.', v_org_total + (case when v_org_created then 1 else 0 end);
end $$;

-- Verification: the same chain `resolveActor()` walks server-side.
select
  u.id                                   as auth_user_id,
  (p.id is not null)                     as profile_exists,
  o.id                                   as organization_id,
  o.slug                                  as organization_slug,
  m.role                                  as membership_role,
  (m.role in ('owner', 'admin'))          as owner_or_admin
from auth.users u
left join public.profiles p on p.id = u.id
left join public.memberships m on m.user_id = u.id
left join public.organizations o on o.id = m.organization_id
where lower(u.email) = lower('CHANGE_ME_OWNER_EMAIL')  -- @nibrexo:verify-match
order by m.created_at;
