-- 0012_email_design_studio.sql — Phase 16 visual email design studio.
-- Source: Phase 16 specification (visual email builder), PDF #10 §§4-6, 12-17,
--         PDF #12 §§7, 15-18.
--
-- WHAT THIS ADDS (additive and re-runnable; no table/column/type is dropped and
-- no row is deleted):
--   * email_designs         — one row per saved visual design. `design` holds the
--                             validated block document (blocks + brand tokens +
--                             canvas settings); `status` keeps the existing
--                             draft/active/archived lifecycle so a design is
--                             never sendable until it is promoted.
--   * email_brand_profiles  — one row per organization: logo, brand colours,
--                             typography, button style, header/footer defaults
--                             and reusable saved sections.
--   * email_designs.template_id links a design to the Phase 10 `email_templates`
--     row it was promoted into, so the existing composer, sequences and sending
--     pipeline keep working unchanged.
--
-- WHY JSONB: the block document is a validated, versioned structure owned by the
-- application (src/server/email/render/schema.ts). Storing it as jsonb keeps the
-- tenant boundary (RLS) and the searchable columns (name/category/subject/status)
-- in Postgres while the document schema stays a single source of truth in code.
-- Nothing here stores credentials, tokens or storage paths.
--
-- Tenancy: organization_id is always from the actor (service layer), RLS repeats
-- the boundary at the database level, and the 0005 identity-immutability trigger
-- prevents cross-tenant row moves.

-- --------------------------------------------------------------------------
-- email_designs — saved visual designs
-- --------------------------------------------------------------------------

create table if not exists public.email_designs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  category text not null default 'general' check (length(btrim(category)) between 1 and 80),
  subject text not null default '' check (length(subject) <= 300),
  design jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  source text not null default 'studio'
    check (source in ('studio', 'manager', 'starter', 'template')),
  template_id uuid references public.email_templates (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_designs is
  'Phase 16 visual email designs (block document + brand + canvas settings).';
comment on column public.email_designs.design is
  'Validated EmailDesignDocument JSON: version, blocks[], brand tokens, settings.';
comment on column public.email_designs.template_id is
  'Phase 10 email_templates row this design was promoted into (null until promoted).';

create index if not exists email_designs_org_status_idx
  on public.email_designs (organization_id, status, created_at desc);
create index if not exists email_designs_org_category_idx
  on public.email_designs (organization_id, category, created_at desc);
create index if not exists email_designs_org_name_idx
  on public.email_designs (organization_id, lower(name));
create index if not exists email_designs_org_created_idx
  on public.email_designs (organization_id, created_at desc);
create index if not exists email_designs_org_template_idx
  on public.email_designs (organization_id, template_id)
  where template_id is not null;

-- --------------------------------------------------------------------------
-- email_brand_profiles — organization design system (one row per org)
-- --------------------------------------------------------------------------

create table if not exists public.email_brand_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  brand jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.email_brand_profiles is
  'Phase 16 organization email brand + design system (logo, colours, typography, button style, header/footer defaults, saved sections).';
comment on column public.email_brand_profiles.brand is
  'Validated EmailBrandProfile JSON. Logo references a media_files id; no bytes or storage paths are stored here.';

create index if not exists email_brand_profiles_org_idx
  on public.email_brand_profiles (organization_id);

-- --------------------------------------------------------------------------
-- RLS — same tenant shape as the other workspace tables (0004/0009/0011)
-- --------------------------------------------------------------------------

alter table public.email_designs enable row level security;
alter table public.email_brand_profiles enable row level security;

drop policy if exists email_designs_tenant_select on public.email_designs;
create policy email_designs_tenant_select on public.email_designs
  for select using (public.is_org_member(organization_id));
drop policy if exists email_designs_tenant_insert on public.email_designs;
create policy email_designs_tenant_insert on public.email_designs
  for insert with check (public.is_org_member(organization_id));
drop policy if exists email_designs_tenant_update on public.email_designs;
create policy email_designs_tenant_update on public.email_designs
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists email_designs_admin_delete on public.email_designs;
create policy email_designs_admin_delete on public.email_designs
  for delete using (public.is_org_admin(organization_id));

drop policy if exists email_brand_profiles_tenant_select on public.email_brand_profiles;
create policy email_brand_profiles_tenant_select on public.email_brand_profiles
  for select using (public.is_org_member(organization_id));
drop policy if exists email_brand_profiles_tenant_insert on public.email_brand_profiles;
create policy email_brand_profiles_tenant_insert on public.email_brand_profiles
  for insert with check (public.is_org_member(organization_id));
drop policy if exists email_brand_profiles_tenant_update on public.email_brand_profiles;
create policy email_brand_profiles_tenant_update on public.email_brand_profiles
  for update using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
drop policy if exists email_brand_profiles_admin_delete on public.email_brand_profiles;
create policy email_brand_profiles_admin_delete on public.email_brand_profiles
  for delete using (public.is_org_admin(organization_id));

-- Tenant-identity immutability (0005 pattern) for both new tables.
drop trigger if exists email_designs_tenant_identity_immutable on public.email_designs;
create trigger email_designs_tenant_identity_immutable
  before update on public.email_designs
  for each row execute function public.prevent_tenant_identity_change();
drop trigger if exists email_brand_profiles_tenant_identity_immutable on public.email_brand_profiles;
create trigger email_brand_profiles_tenant_identity_immutable
  before update on public.email_brand_profiles
  for each row execute function public.prevent_tenant_identity_change();
