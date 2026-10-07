import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const migrationsDir = resolve(root, 'supabase/migrations');
const migration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8');

describe('Supabase migration contract', () => {
  it('keeps the baseline migrations in order with hardening, CRM and storage follow-ups', () => {
    const names = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    expect(names).toEqual([
      '0001_core_identity.sql',
      '0002_modules.sql',
      '0003_manager_agent.sql',
      '0004_rls_policies.sql',
      '0005_rls_hardening.sql',
      '0006_clients_crm.sql',
      '0007_content_storage.sql',
    ]);
  });

  it('adds the Phase 5 CRM fields without touching tenant protections', () => {
    const crm = migration('0006_clients_crm.sql');
    expect(crm).toContain('add column if not exists phone');
    expect(crm).toContain("add value if not exists 'prospect'");
    expect(crm).toContain("add value if not exists 'inactive'");
    expect(crm).toContain("add value if not exists 'completed'");
    expect(crm).toContain('client_activity_org_idx');
    expect(crm).not.toContain('drop policy');
    expect(crm).not.toContain('create policy');
  });

  it('defines auth-backed identity, memberships and organization helpers', () => {
    const sql = migration('0001_core_identity.sql');
    expect(sql).toContain('create table if not exists public.organizations');
    expect(sql).toContain('create table if not exists public.profiles');
    expect(sql).toContain('create table if not exists public.memberships');
    expect(sql).toContain('references auth.users');
    expect(sql).toContain('function public.is_org_member');
    expect(sql).toContain('function public.org_role_of');
  });

  it('defines the module and Manager persistence tables used by the repository', () => {
    const modules = migration('0002_modules.sql');
    const manager = migration('0003_manager_agent.sql');
    for (const table of ['clients', 'leads', 'content_items', 'email_logs', 'social_accounts']) {
      expect(modules).toContain(`public.${table}`);
    }
    for (const table of ['ai_tasks', 'ai_actions', 'ai_memory', 'approvals', 'research_briefs', 'product_concepts', 'quality_reports']) {
      expect(manager).toContain(`public.${table}`);
    }
  });

  it('enables baseline tenant RLS and corrects additive sensitive UPDATE policies', () => {
    const baseline = migration('0004_rls_policies.sql');
    const hardening = migration('0005_rls_hardening.sql');
    expect(baseline).toContain("'ai_tasks','ai_actions','ai_memory','approvals'");
    expect(baseline).toContain('enable row level security');
    expect(hardening).toContain('drop policy if exists approvals_tenant_update');
    expect(hardening).toContain('create policy approvals_decide');
    expect(hardening).toContain('drop policy if exists ai_tasks_tenant_update');
    expect(hardening).toContain('create policy ai_tasks_requester_update');
    expect(hardening).toContain('drop policy if exists social_credentials_tenant_select');
    expect(hardening).toContain('create policy social_credentials_admin_select');
  });

  it('drops every policy it creates, so the migration set is safe to re-apply', () => {
    // Regression guard for `42710: policy "…" already exists`: a SQL-Editor
    // project may apply a file twice (retry after a partial failure), and
    // `supabase db push` on a database that was set up by hand must also be
    // safe. Policies created inside the dynamic tenant loop use format('%I', …)
    // and are excluded by this pattern.
    for (const name of ['0004_rls_policies.sql', '0005_rls_hardening.sql']) {
      const sql = migration(name);
      const created = [...sql.matchAll(/create policy\s+([a-z0-9_]+)/g)].map((match) => match[1]);
      expect(created.length).toBeGreaterThan(0);
      for (const policy of new Set(created)) {
        expect(sql, `${name} creates ${policy} without dropping it first`).toContain(
          `drop policy if exists ${policy} `,
        );
      }
    }
  });

  it('creates the private media bucket with organization-scoped storage RLS', () => {
    const storage = migration('0007_content_storage.sql');
    expect(storage).toContain('insert into storage.buckets');
    expect(storage).toContain("'nibrexo-media'");
    expect(storage).toContain('false,');
    expect(storage).toContain('on conflict (id) do update');
    expect(storage).toContain('nibrexo_media_member_select');
    expect(storage).toContain('nibrexo_media_member_insert');
    expect(storage).toContain('nibrexo_media_member_update');
    expect(storage).toContain('nibrexo_media_admin_delete');
    expect(storage).toContain('public.is_org_member');
    expect(storage).toContain('public.is_org_admin');
    expect(storage).toContain('storage.foldername(name)');
    // Guarded for databases without the Supabase storage schema (PGlite).
    expect(storage).toContain("to_regclass('storage.buckets')");
    expect(storage).toContain("to_regclass('storage.objects')");
  });

  it('never deletes data in any migration', () => {
    for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'))) {
      const sql = migration(name);
      expect(sql, `${name} must not drop tables or columns`).not.toMatch(
        /drop\s+(table|column|type|schema|database)\b/i,
      );
      expect(sql, `${name} must not truncate or delete rows`).not.toMatch(
        /\b(truncate|delete\s+from)\b/i,
      );
    }
  });

  it('keeps the audit log append-only and tenant identity immutable', () => {
    const hardening = migration('0005_rls_hardening.sql');
    expect(hardening).toContain('function public.prevent_tenant_identity_change');
    expect(hardening).toContain('organization_id is immutable');
    expect(hardening).toContain('drop policy if exists activity_logs_tenant_update');
    expect(hardening).toContain('drop policy if exists activity_logs_admin_delete');
  });

  it('does not send updated_at to the append-only activity_logs table', () => {
    const repository = readFileSync(resolve(root, 'src/server/db/supabase-repository.ts'), 'utf8');
    expect(repository).toContain("TABLES_WITHOUT_UPDATED_AT = new Set(['activity_logs'])");
    expect(repository).toContain('...(supportsUpdatedAt ? { updated_at: new Date().toISOString() } : {})');
  });
});
