/**
 * Supabase/PostgreSQL repository.
 *
 * Every collection is tenant-scoped: `organization_id` is part of every
 * filter, and RLS provides the database-level boundary underneath
 * (PDF #05 §9, PDF #11 §5, PDF #12 §17).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { newId } from '@/lib/id';
import type { PublishJob, UUID } from '@/types/domain';
import type { ManagerTaskSnapshot } from '@/types/manager';
import type { BaseRow, Collection, NibrexoRepository, PublishJobCollection } from './types';
import { createSupabaseInboxRepository } from './supabase-inbox';

const DEFAULT_LIMIT = 100;

/** Tables that intentionally have an immutable append-only audit shape. */
const TABLES_WITHOUT_UPDATED_AT = new Set(['activity_logs']);

function createCollection<T extends BaseRow>(
  client: SupabaseClient,
  table: string,
): Collection<T> {
  const supportsUpdatedAt = !TABLES_WITHOUT_UPDATED_AT.has(table);

  return {
    async list(organizationId, options = {}) {
      const limit = options.limit ?? DEFAULT_LIMIT;
      const query = client
        .from(table)
        .select('*')
        .eq('organization_id', organizationId)
        .order(options.orderBy ?? 'created_at', { ascending: options.ascending ?? false })
        .range(options.offset ?? 0, (options.offset ?? 0) + limit - 1);

      const { data, error } = await query;
      if (error) throw new Error(`Supabase read failed for ${table}: ${error.message}`);
      return (data ?? []) as unknown as T[];
    },

    async insert(row) {
      const payload: Record<string, unknown> = {
        ...(row as Record<string, unknown>),
        id: (row as { id?: UUID }).id ?? newId(),
        created_at: (row as { created_at?: string }).created_at ?? new Date().toISOString(),
        ...(supportsUpdatedAt ? { updated_at: new Date().toISOString() } : {}),
      };
      const { data, error } = await client.from(table).insert(payload).select().single();
      if (error) throw new Error(`Supabase insert failed for ${table}: ${error.message}`);
      return data as unknown as T;
    },

    async update(id, organizationId, patch) {
      const payload: Record<string, unknown> = {
        ...(patch as Record<string, unknown>),
        ...(supportsUpdatedAt ? { updated_at: new Date().toISOString() } : {}),
      };
      const { data, error } = await client
        .from(table)
        .update(payload)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select()
        .maybeSingle();
      if (error) throw new Error(`Supabase update failed for ${table}: ${error.message}`);
      return (data as unknown as T) ?? null;
    },

    async get(id, organizationId) {
      const { data, error } = await client
        .from(table)
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .maybeSingle();
      if (error) throw new Error(`Supabase read failed for ${table}: ${error.message}`);
      return (data as unknown as T) ?? null;
    },

    async delete(id, organizationId) {
      const { data, error } = await client
        .from(table)
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select('id');
      if (error) throw new Error(`Supabase delete failed for ${table}: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },
  };
}

/** Maps the persisted ai_tasks row onto the in-process task snapshot. */
function toSnapshot(row: Record<string, unknown>): ManagerTaskSnapshot {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    request: String(row.request ?? ''),
    state: row.state as ManagerTaskSnapshot['state'],
    intent: (row.intent as ManagerTaskSnapshot['intent']) ?? null,
    plan: (row.plan as ManagerTaskSnapshot['plan']) ?? null,
    stepResults: (row.step_results as ManagerTaskSnapshot['stepResults']) ?? [],
    trace: (row.trace as ManagerTaskSnapshot['trace']) ?? [],
    result: (row.result as ManagerTaskSnapshot['result']) ?? null,
    error: (row.error as string) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? row.created_at ?? ''),
  };
}

function fromSnapshot(task: ManagerTaskSnapshot): Record<string, unknown> {
  return {
    id: task.id,
    organization_id: task.organizationId,
    user_id: task.userId,
    request: task.request,
    state: task.state,
    intent: task.intent,
    plan: task.plan,
    step_results: task.stepResults,
    trace: task.trace,
    result: task.result,
    error: task.error,
    created_at: task.createdAt,
    updated_at: new Date().toISOString(),
  };
}

const COUNT_TABLES = [
  'clients',
  'media_files',
  'leads',
  'content_items',
  'email_templates',
  'email_logs',
  'email_designs',
  'social_accounts',
  'research_briefs',
  'approvals',
  'activity_logs',
] as const;

function createPublishJobCollection(client: SupabaseClient): PublishJobCollection {
  const base = createCollection<PublishJob>(client, 'publish_jobs');
  return {
    ...base,
    async findByIdempotencyKey(organizationId, key) {
      const { data, error } = await client
        .from('publish_jobs')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('idempotency_key', key)
        .maybeSingle();
      if (error) throw new Error(`Supabase read failed for publish_jobs: ${error.message}`);
      return (data as unknown as PublishJob) ?? null;
    },
    async claimDueJobs(nowIso, lockSeconds, limit) {
      const { data, error } = await client.rpc('claim_due_publish_jobs', {
        p_now: nowIso,
        p_lock_seconds: lockSeconds,
        p_limit: limit,
      });
      if (error) throw new Error(`Supabase claim failed for publish_jobs: ${error.message}`);
      return (data ?? []) as unknown as PublishJob[];
    },
  };
}

export function createSupabaseRepository(client: SupabaseClient): NibrexoRepository {
  const collection = <T extends BaseRow>(table: string): Collection<T> =>
    createCollection<T>(client, table);

  return {
    backend: 'supabase',

    clients: collection('clients'),
    clientActivity: collection('client_activity'),
    mediaFiles: collection('media_files'),
    leads: collection('leads'),
    contentItems: collection('content_items'),
    emailTemplates: collection('email_templates'),
    emailLogs: collection('email_logs'),
    emailSequences: collection('email_sequences'),
    emailDesigns: collection('email_designs'),
    emailBrandProfiles: collection('email_brand_profiles'),
    socialAccounts: collection('social_accounts'),
    socialCredentials: collection('social_credentials'),
    socialOauthStates: collection('social_oauth_states'),
    publishJobs: createPublishJobCollection(client),
    inbox: createSupabaseInboxRepository(client),
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
        const { data, error } = await client
          .from('ai_tasks')
          .insert(fromSnapshot(task))
          .select()
          .single();
        if (error) throw new Error(`Supabase task create failed: ${error.message}`);
        return toSnapshot(data as Record<string, unknown>);
      },

      async get(id, organizationId) {
        const { data, error } = await client
          .from('ai_tasks')
          .select('*')
          .eq('id', id)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (error) throw new Error(`Supabase task read failed: ${error.message}`);
        return data ? toSnapshot(data as Record<string, unknown>) : null;
      },

      async update(id, organizationId, patch) {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.state !== undefined) payload.state = patch.state;
        if (patch.intent !== undefined) payload.intent = patch.intent;
        if (patch.plan !== undefined) payload.plan = patch.plan;
        if (patch.stepResults !== undefined) payload.step_results = patch.stepResults;
        if (patch.trace !== undefined) payload.trace = patch.trace;
        if (patch.result !== undefined) payload.result = patch.result;
        if (patch.error !== undefined) payload.error = patch.error;

        const { data, error } = await client
          .from('ai_tasks')
          .update(payload)
          .eq('id', id)
          .eq('organization_id', organizationId)
          .select()
          .maybeSingle();
        if (error) throw new Error(`Supabase task update failed: ${error.message}`);
        return data ? toSnapshot(data as Record<string, unknown>) : null;
      },

      async list(organizationId, options = {}) {
        const limit = options.limit ?? 50;
        const { data, error } = await client
          .from('ai_tasks')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .range(options.offset ?? 0, (options.offset ?? 0) + limit - 1);
        if (error) throw new Error(`Supabase task list failed: ${error.message}`);
        return ((data ?? []) as Record<string, unknown>[]).map(toSnapshot);
      },
    },

    async counts(organizationId) {
      const entries = await Promise.all(
        COUNT_TABLES.map(async (table) => {
          const { count, error } = await client
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId);
          if (error) throw new Error(`Supabase count failed for ${table}: ${error.message}`);
          return [table, count ?? 0] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  };
}
