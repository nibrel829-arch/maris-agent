-- Nibrexo OS AI — Migration 0007: Content Library storage (Phase 6)
-- Source: Phase 6 build (PDF #12 §2 Content, §7 Content scope).
--
-- Creates the private `nibrexo-media` Storage bucket and organization-scoped
-- RLS policies on `storage.objects`. Application object paths always start
-- with the organization id (`<org-uuid>/<unique-filename>`), and every policy
-- reuses the 0001 membership helpers, so the tenant boundary matches the
-- table RLS from 0004 (members manage, deletes are owner/admin-only).
--
-- The bucket and policies only exist where the Supabase `storage` schema
-- exists (every real Supabase project). The embedded-PostgreSQL harness has
-- no storage schema, so each block below is guarded by `to_regclass` and
-- skips with a notice there. Re-runnable everywhere: the bucket insert uses
-- `on conflict do update`, and every policy is dropped before creation.

-- Bucket -------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'SKIP: storage schema not present; the nibrexo-media bucket applies to Supabase projects only.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'nibrexo-media',
    'nibrexo-media',
    false,
    10485760,
    array[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'video/mp4', 'video/quicktime', 'video/webm',
      'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
      'application/pdf'
    ]
  )
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
end $$;

-- Object policies ------------------------------------------------------------
-- Path convention: <organization-uuid>/<unique-filename>. The first folder is
-- the tenant key; malformed paths fail closed (the cast raises, the policy
-- rejects the row). `storage.foldername` is the Supabase-provided helper that
-- splits an object path into its folders.
do $$
declare
  tenant text := '(bucket_id = ''nibrexo-media'' and public.is_org_member(((storage.foldername(name))[1])::uuid))';
  tenant_admin text := '(bucket_id = ''nibrexo-media'' and public.is_org_admin(((storage.foldername(name))[1])::uuid))';
begin
  if to_regclass('storage.objects') is null then
    raise notice 'SKIP: storage schema not present; nibrexo-media policies apply to Supabase projects only.';
    return;
  end if;

  execute 'alter table storage.objects enable row level security';

  execute 'drop policy if exists nibrexo_media_member_select on storage.objects';
  execute 'create policy nibrexo_media_member_select on storage.objects for select to authenticated using ' || tenant;

  execute 'drop policy if exists nibrexo_media_member_insert on storage.objects';
  execute 'create policy nibrexo_media_member_insert on storage.objects for insert to authenticated with check ' || tenant;

  execute 'drop policy if exists nibrexo_media_member_update on storage.objects';
  execute 'create policy nibrexo_media_member_update on storage.objects for update to authenticated using ' || tenant || ' with check ' || tenant;

  execute 'drop policy if exists nibrexo_media_admin_delete on storage.objects';
  execute 'create policy nibrexo_media_admin_delete on storage.objects for delete to authenticated using ' || tenant_admin;
end $$;
