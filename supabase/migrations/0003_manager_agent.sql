-- Nibrexo OS AI — Migration 0003: NIBREXO CEO / Manager Agent
-- Source: PDF #05 §8 AI Agent Data Layer, PDF #08, CEO spec §3/§5/§9
--
-- ai_tasks:      one Manager task, persisted through the PDF #08 §16 state machine
-- ai_actions:    per-step execution results
-- ai_memory:     permission-scoped working memory
-- approvals:     human approval gate for external / high-impact actions
-- research/product/visual/campaign/social/community/quality: skill artifacts

do $$
begin
  if not exists (select 1 from pg_type where typname = 'manager_task_state') then
    create type public.manager_task_state as enum (
      'RECEIVED','PLANNING','WAITING_APPROVAL','EXECUTING','VERIFYING','COMPLETED','FAILED','CANCELLED'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'approval_status') then
    create type public.approval_status as enum ('pending','approved','rejected','expired','cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'risk_level') then
    create type public.risk_level as enum ('low','medium','high');
  end if;
  if not exists (select 1 from pg_type where typname = 'evidence_grade') then
    create type public.evidence_grade as enum ('FACT','EVIDENCE','INTERPRETATION','RECOMMENDATION');
  end if;
  if not exists (select 1 from pg_type where typname = 'research_domain') then
    create type public.research_domain as enum ('general','dental','market','product','competitor');
  end if;
end $$;

-- Manager tasks ------------------------------------------------------------
create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  request text not null,
  state public.manager_task_state not null default 'RECEIVED',
  intent jsonb,
  plan jsonb,
  step_results jsonb not null default '[]'::jsonb,
  trace jsonb not null default '[]'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_tasks_org_idx on public.ai_tasks (organization_id, created_at desc);
create index if not exists ai_tasks_state_idx on public.ai_tasks (organization_id, state);

-- Per-step execution records ----------------------------------------------
create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  step_id text not null,
  tool_name text,
  skill_id text,
  status text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  issues jsonb not null default '[]'::jsonb,
  duration_ms integer,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, step_id)
);
create index if not exists ai_actions_task_idx on public.ai_actions (task_id);

-- Permission-scoped memory -------------------------------------------------
create table if not exists public.ai_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  scope text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, scope, key)
);
create index if not exists ai_memory_scope_idx on public.ai_memory (organization_id, scope);

-- Approvals ----------------------------------------------------------------
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid references public.ai_tasks (id) on delete cascade,
  step_id text,
  action text not null,
  tool_name text not null,
  risk public.risk_level not null,
  reason text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.approval_status not null default 'pending',
  requested_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decision_note text,
  expires_at timestamptz not null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists approvals_org_status_idx on public.approvals (organization_id, status);
create index if not exists approvals_task_idx on public.approvals (task_id);
create index if not exists approvals_expiry_idx on public.approvals (expires_at);

-- Skill artifacts ----------------------------------------------------------
create table if not exists public.research_briefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  topic text not null,
  domain public.research_domain not null default 'general',
  question text not null,
  structure text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  gaps text[] not null default '{}',
  recommendations text[] not null default '{}',
  medical_review_required boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists research_briefs_org_idx on public.research_briefs (organization_id, created_at desc);

create table if not exists public.product_concepts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  target_customer text not null,
  problem text not null,
  demand_signal text,
  alternatives text[] not null default '{}',
  missing_opportunity text not null default '',
  scope text[] not null default '{}',
  components text[] not null default '{}',
  versions text[] not null default '{}',
  file_types text[] not null default '{}',
  differentiation text[] not null default '{}',
  pricing_considerations text[] not null default '{}',
  open_questions text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.visual_concepts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  purpose text not null,
  formats text[] not null default '{}',
  message_hierarchy text[] not null default '{}',
  asset_list text[] not null default '{}',
  accessibility_notes text[] not null default '{}',
  brand_consistency_notes text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  objective text not null,
  audience text not null,
  channels text[] not null default '{}',
  messages text[] not null default '{}',
  timeline text[] not null default '{}',
  success_measures text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  platforms text[] not null default '{}',
  cadence text not null,
  themes text[] not null default '{}',
  content_pillars text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.community_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  channels text[] not null default '{}',
  response_guidelines text[] not null default '{}',
  escalation_rules text[] not null default '{}',
  engagement_rituals text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quality_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subject text not null,
  passed boolean not null,
  score integer not null check (score between 0 and 100),
  blocking boolean not null default false,
  findings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quality_reports_org_idx on public.quality_reports (organization_id, created_at desc);
