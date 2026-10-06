import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const migrationsDir = resolve(root, 'supabase/migrations');
const migration = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8');

describe('Supabase migration contract', () => {
  it('keeps the four baseline migrations in order and adds a corrective hardening migration', () => {
    const names = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
    expect(names).toEqual([
      '0001_core_identity.sql',
      '0002_modules.sql',
      '0003_manager_agent.sql',
      '0004_rls_policies.sql',
      '0005_rls_hardening.sql',
    ]);
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
