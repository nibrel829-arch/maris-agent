/**
 * In-memory repository — LOCAL DEVELOPMENT AND TESTS ONLY.
 *
 * It is a real, working store: reads and writes behave consistently within a
 * process. It is not a simulation of Supabase success — `server/db/index.ts`
 * refuses to construct it when NODE_ENV=production.
 */

import { newId } from '@/lib/id';
import type { UUID } from '@/types/domain';
import type { BaseRow, Collection, NibrexoRepository } from './types';
import type { ManagerTaskSnapshot } from '@/types/manager';

type Store = Map<string, Map<string, Record<string, unknown>>>;

function nowIso(): string {
  return new Date().toISOString();
}

function createCollection<T extends BaseRow>(store: Store, table: string): Collection<T> {
  const tableStore = (): Map<string, Record<string, unknown>> => {
    let t = store.get(table);
    if (!t) {
      t = new Map();
      store.set(table, t);
    }
    return t;
  };

  const matches = (row: Record<string, unknown>, organizationId: UUID): boolean =>
    row.organization_id === organizationId;

  return {
    async list(organizationId, options = {}) {
      const rows = [...tableStore().values()]
        .filter((row) => matches(row, organizationId))
        .sort((a, b) => {
          const key = options.orderBy ?? 'created_at';
          const av = String(a[key] ?? '');
          const bv = String(b[key] ?? '');
          return options.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 100;
      return rows.slice(offset, offset + limit) as unknown as T[];
    },

    async insert(row) {
      const id = (row as { id?: UUID }).id ?? newId();
      const record: Record<string, unknown> = {
        ...(row as Record<string, unknown>),
        id,
        created_at: (row as { created_at?: string }).created_at ?? nowIso(),
        updated_at: nowIso(),
      };
      tableStore().set(id, record);
      return record as unknown as T;
    },

    async update(id, organizationId, patch) {
      const existing = tableStore().get(id);
      if (!existing || !matches(existing, organizationId)) return null;
      const next = { ...existing, ...(patch as Record<string, unknown>), updated_at: nowIso() };
      tableStore().set(id, next);
      return next as unknown as T;
    },

    async get(id, organizationId) {
      const existing = tableStore().get(id);
      if (!existing || !matches(existing, organizationId)) return null;
      return existing as unknown as T;
    },

    async delete(id, organizationId) {
      const existing = tableStore().get(id);
      if (!existing || !matches(existing, organizationId)) return false;
      tableStore().delete(id);
      return true;
    },
  };
}

export function createMemoryRepository(seed?: Store): NibrexoRepository {
  const store: Store = seed ? new Map(seed) : new Map();

  const taskStore = (): Map<string, Record<string, unknown>> => {
    let t = store.get('manager_tasks');
    if (!t) {
      t = new Map();
      store.set('manager_tasks', t);
    }
    return t;
  };

  const tables = [
    'clients',
    'client_activity',
    'media_files',
    'leads',
    'content_items',
    'email_templates',
    'email_logs',
    'email_sequences',
    'social_accounts',
    'research_briefs',
    'product_concepts',
    'visual_concepts',
    'campaign_plans',
    'social_plans',
    'community_plans',
    'quality_reports',
    'approvals',
    'activity_logs',
    'notifications',
    'manager_memory',
  ] as const;

  const collection = <T extends BaseRow>(table: string): Collection<T> =>
    createCollection<T>(store, table);

  return {
    backend: 'memory',

    clients: collection('clients'),
    clientActivity: collection('client_activity'),
    mediaFiles: collection('media_files'),
    leads: collection('leads'),
    contentItems: collection('content_items'),
    emailTemplates: collection('email_templates'),
    emailLogs: collection('email_logs'),
    emailSequences: collection('email_sequences'),
    socialAccounts: collection('social_accounts'),
    researchBriefs: collection('research_briefs'),
    productConcepts: collection('product_concepts'),
    visualConcepts: collection('visual_concepts'),
    campaignPlans: collection('campaign_plans'),
    socialPlans: collection('social_plans'),
    communityPlans: collection('community_plans'),
    qualityReports: collection('quality_reports'),
    approvals: collection('approvals'),
    activityLogs: collection('activity_logs'),
    notifications: collection('notifications'),
    memory: collection('manager_memory'),

    tasks: {
      async create(task) {
        const record = { ...task, createdAt: task.createdAt ?? nowIso(), updatedAt: nowIso() };
        taskStore().set(task.id, record as unknown as Record<string, unknown>);
        return task;
      },
      async get(id, organizationId) {
        const row = taskStore().get(id);
        if (!row || row.organizationId !== organizationId) return null;
        return row as unknown as ManagerTaskSnapshot;
      },
      async update(id, organizationId, patch) {
        const row = taskStore().get(id);
        if (!row || row.organizationId !== organizationId) return null;
        const next = { ...row, ...patch, updatedAt: nowIso() };
        taskStore().set(id, next as unknown as Record<string, unknown>);
        return next as unknown as ManagerTaskSnapshot;
      },
      async list(organizationId, options = {}) {
        const rows = [...taskStore().values()].filter(
          (row) => row.organizationId === organizationId,
        );
        const offset = options.offset ?? 0;
        const limit = options.limit ?? 50;
        return rows
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
          .slice(offset, offset + limit) as unknown as ManagerTaskSnapshot[];
      },
    },

    async counts(organizationId) {
      const result: Record<string, number> = {};
      for (const table of tables) {
        const t = store.get(table);
        result[table] = t ? [...t.values()].filter((r) => r.organization_id === organizationId).length : 0;
      }
      return result;
    },
  };
}
