-- Nibrexo OS AI — Migration 0006: Clients/CRM Phase 5 fields
-- Source: Phase 5 build (PDF #12 §2 Clients/CRM, §7 CRM scope).
--
-- Additive only, re-runnable:
--  * `clients.phone` — nullable contact phone number (Phase 5 requirement).
--  * `client_status` gains `prospect`, `inactive`, `completed` — the Phase 5
--    CRM statuses. Pre-existing values (`lead`, `qualified`, `active`,
--    `paused`, `churned`) are preserved, so rows created before Phase 5 keep
--    working and no data migration is needed.
--  * `client_activity_org_idx` — organization-scoped timeline reads.
--
-- RLS is unchanged: `clients` and `client_activity` keep their 0004 tenant
-- policies and the 0005 tenant-identity immutability trigger. No table,
-- policy or trigger is added or removed here.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block and
-- a new value cannot be used in the same transaction that adds it, so each
-- statement below is a top-level statement and this file inserts no rows.

alter table public.clients
  add column if not exists phone text;

alter type public.client_status add value if not exists 'prospect';
alter type public.client_status add value if not exists 'inactive';
alter type public.client_status add value if not exists 'completed';

create index if not exists client_activity_org_idx
  on public.client_activity (organization_id, created_at desc);
