-- Nibrexo OS AI — schema preflight / drift diagnosis (READ-ONLY).
--
-- WHERE TO RUN THIS
--   Supabase Dashboard -> SQL Editor (or `psql "$DATABASE_URL"`).
--
--   There is no write statement in this file: no `insert`, `update`, `delete`,
--   `drop`, `alter`, `create` or `truncate`. It only reads the system catalogs
--   (pg_type, pg_class, pg_proc, pg_policy, pg_trigger, pg_policies,
--   information_schema) and never selects from the Nibrexo tables themselves,
--   so it cannot fail when objects are missing — which is exactly when it is
--   needed.
--
-- WHY THIS EXISTS
--   `ERROR 42704: type "public.org_role" does not exist` while running
--   `supabase/scripts/provision_owner.sql` means the live project is missing
--   objects that `supabase/migrations/0001_core_identity.sql` defines. The
--   bootstrap deliberately does not create schema objects, so the fix is to
--   apply the repository migrations — never to create the type by hand.
--
-- HOW TO READ THE RESULT
--   Grid 1 "REQUIRED OBJECTS"      every row must be `ok` before provisioning.
--   Grid 2 "SCHEMA OBJECT COUNT"   overview; `public_enums` must be >= 1 for a
--                                  fully applied 0001-0006 set (14 enums total;
--                                  0006 adds enum *values*, not types).
--   Grid 3 "TABLES + RLS"          every Nibrexo tenant table needs rls_enabled
--                                  = true and at least one policy.
--   Grid 4 "SAME-NAMED TYPES"      the 0001 guards match by type name in any
--                                  schema; a row here (outside `public`) is why
--                                  a type could be skipped. Expect no rows.
--   Notices                        migration bookkeeping + what to do next.
--
-- NEXT ACTION (see docs/SUPABASE_VERIFICATION.md)
--   Apply `supabase/migrations/0001_core_identity.sql` through
--   `0006_clients_crm.sql` in order — via `supabase db push` (CLI) or by
--   pasting each file into the SQL Editor in order. They are re-runnable:
--   every `create table`/`create index` is `if not exists`, every `create type`
--   is guarded, and the only `drop` statements are `drop policy if exists`.
--   Then re-run `supabase/scripts/provision_owner.sql` unchanged.

-- --------------------------------------------------------------------------
-- Grid 1 — every object the owner bootstrap and the actor resolution need.
-- --------------------------------------------------------------------------
select
  required.object_kind  as kind,
  required.object_name  as object_name,
  case when required.present then 'ok' else 'MISSING' end as status,
  required.created_by   as defined_in
from (
  -- Identity and tenancy (migration 0001)
  select 'type'::text as object_kind, 'public.org_role'::text as object_name,
         to_regtype('public.org_role') is not null as present,
         'migrations/0001_core_identity.sql'::text as created_by
  union all
  select 'type', 'public.notification_severity',
         to_regtype('public.notification_severity') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'table', 'public.organizations',
         to_regclass('public.organizations') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'table', 'public.profiles',
         to_regclass('public.profiles') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'table', 'public.memberships',
         to_regclass('public.memberships') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'table', 'public.activity_logs',
         to_regclass('public.activity_logs') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'table', 'public.notifications',
         to_regclass('public.notifications') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'table', 'public.settings',
         to_regclass('public.settings') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'function', 'public.is_org_member(uuid)',
         to_regprocedure('public.is_org_member(uuid)') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'function', 'public.org_role_of(uuid)',
         to_regprocedure('public.org_role_of(uuid)') is not null,
         'migrations/0001_core_identity.sql'
  union all
  select 'function', 'public.is_org_admin(uuid)',
         to_regprocedure('public.is_org_admin(uuid)') is not null,
         'migrations/0004_rls_policies.sql'
  union all
  select 'function', 'public.prevent_tenant_identity_change()',
         to_regprocedure('public.prevent_tenant_identity_change()') is not null,
         'migrations/0005_rls_hardening.sql'
  union all
  select 'table', 'public.clients',
         to_regclass('public.clients') is not null,
         'migrations/0002_modules.sql'
  union all
  select 'column', 'public.clients.phone',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'clients'
                    and column_name = 'phone'),
         'migrations/0006_clients_crm.sql'
  union all
  select 'table', 'public.ai_tasks',
         to_regclass('public.ai_tasks') is not null,
         'migrations/0003_manager_agent.sql'
  union all
  select 'table', 'public.approvals',
         to_regclass('public.approvals') is not null,
         'migrations/0003_manager_agent.sql'
) as required
order by (required.present) asc, required.object_kind, required.object_name;

-- --------------------------------------------------------------------------
-- Grid 2 — overview counts. A fully applied 0001-0006 set creates 34 tables
-- and 14 enums in `public` (0001: 2, 0002: 7, 0003: 5; 0006 adds enum values
-- and a column, not tables or types).
-- --------------------------------------------------------------------------
select
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r')            as public_tables,
  (select count(*)
     from pg_type t
     join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e')            as public_enums,
  (select count(*) from pg_policies where schemaname = 'public') as public_policies,
  (select count(*)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as tables_with_rls;

-- --------------------------------------------------------------------------
-- Grid 3 — every `public` table with its RLS state and policy count.
-- --------------------------------------------------------------------------
select
  c.relname                                     as table_name,
  c.relrowsecurity                              as rls_enabled,
  c.relforcerowsecurity                         as rls_forced,
  (select count(*)
     from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- --------------------------------------------------------------------------
-- Grid 4 — same-named types anywhere in the database. The 0001/0002/0003
-- guards match on `typname` without a schema filter, so a type with the same
-- name in another schema would make the guard skip creation. Expect no rows.
-- --------------------------------------------------------------------------
select n.nspname as schema_name, t.typname as type_name
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
where t.typname in ('org_role', 'notification_severity')
order by n.nspname, t.typname;

-- --------------------------------------------------------------------------
-- Notices — Supabase CLI migration bookkeeping and the exact next action.
-- --------------------------------------------------------------------------
do $$
declare
  v_count    int;
  v_versions text;
  v_enums    int;
  v_type     boolean;
  v_tables   boolean;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise notice 'MIGRATION BOOKKEEPING: supabase_migrations.schema_migrations does not exist → the Supabase CLI has never pushed a migration to this project.';
  else
    execute 'select count(*) from supabase_migrations.schema_migrations' into v_count;
    execute 'select string_agg(version, '', '' order by version) from supabase_migrations.schema_migrations'
      into v_versions;
    raise notice 'MIGRATION BOOKKEEPING: % migration(s) recorded → %', v_count, coalesce(v_versions, '(none)');
    raise notice 'BOOKKEEPING CAVEAT: recorded versions prove the CLI ran, not that the objects still exist. Grids 1-3 are authoritative.';
  end if;

  select count(*) into v_enums
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e';
  v_type   := to_regtype('public.org_role') is not null;
  v_tables := to_regclass('public.organizations') is not null
              and to_regclass('public.profiles') is not null
              and to_regclass('public.memberships') is not null;

  if not v_type or not v_tables then
    raise notice 'ACTION REQUIRED: the Nibrexo schema is not applied to this project (% public enums). Apply supabase/migrations 0001 → 0006 in order, then re-run supabase/scripts/provision_owner.sql unchanged.', v_enums;
    raise notice 'Do NOT create public.org_role or any Nibrexo table by hand: the migration is the single source of truth.';
  elsif v_enums >= 14 then
    raise notice 'SCHEMA OK: public.org_role and the identity tables exist (% public enums). Verify grids 1-3 are all ok, then run supabase/scripts/provision_owner.sql unchanged.', v_enums;
  else
    raise notice 'SCHEMA PARTIAL: the identity tables exist but only % of the 14 expected public enums are present. Re-apply 0002 → 0006 in order to finish (they are re-runnable).', v_enums;
  end if;
end $$;
