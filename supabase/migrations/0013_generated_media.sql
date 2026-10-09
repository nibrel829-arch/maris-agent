-- 0013_generated_media.sql — link verified generated images to the Manager task.
-- Existing media_files rows stay valid. New columns are nullable. RLS already
-- scopes this table by organization_id; no policy is weakened.

alter table public.media_files
  add column if not exists task_id uuid references public.ai_tasks (id) on delete set null,
  add column if not exists step_id text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists prompt text,
  add column if not exists negative_prompt text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists sha256 text;

alter table public.media_files
  drop constraint if exists media_files_generated_size_check;

alter table public.media_files
  add constraint media_files_generated_size_check check (size_bytes <= 10485760);

create index if not exists media_files_task_idx
  on public.media_files (organization_id, task_id);
