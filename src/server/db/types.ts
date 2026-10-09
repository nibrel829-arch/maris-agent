/**
 * Data layer contract (PDF #06 §3 Database Layer, PDF #05).
 *
 * Two implementations exist:
 *  - SupabaseRepository  — production. Talks to Supabase PostgreSQL where RLS
 *                          enforces tenant isolation.
 *  - MemoryRepository    — local development and tests ONLY. It is refused in
 *                          production (see server/db/index.ts) so it can never
 *                          silently swallow real data.
 *
 * Neither implementation invents a success: an unavailable backend surfaces a
 * structured NOT_CONFIGURED / DB_ERROR result (CEO spec §11).
 */

import type {
  ActivityLog,
  ApprovalRecord,
  Client,
  MediaFile,
  ClientActivity,
  ContentItem,
  EmailLog,
  EmailTemplate,
  EmailBrandProfileRecord,
  EmailDesign,
  Lead,
  ProductConcept,
  PublishJob,
  ResearchBrief,
  SocialAccount,
  SocialCredential,
  SocialOAuthState,
  UUID,
} from '@/types/domain';
import type { ManagerTaskSnapshot } from '@/types/manager';
import type { InboxDataAccess } from '@/types/inbox';

export interface BaseRow {
  id: UUID;
  organization_id: UUID;
  created_at: string;
  updated_at?: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  ascending?: boolean;
}

export interface Collection<T extends BaseRow> {
  list(organizationId: UUID, options?: ListOptions): Promise<T[]>;
  insert(
    row: Omit<T, 'id' | 'created_at' | 'updated_at'> &
      Partial<Pick<T, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<T>;
  update(id: UUID, organizationId: UUID, patch: Partial<T>): Promise<T | null>;
  get(id: UUID, organizationId: UUID): Promise<T | null>;
  /** Tenant-scoped delete. Resolves true only when a row was removed. */
  delete(id: UUID, organizationId: UUID): Promise<boolean>;
}

/**
 * Publish-job queue. `findByIdempotencyKey` resolves retried submissions to
 * the existing row; `claimDueJobs` hands each due row to exactly one sweeper
 * (Postgres: `claim_due_publish_jobs()` with SKIP LOCKED; memory: atomic
 * in-process claim). Claiming bumps `attempts` and sets the lock lease.
 */
export interface PublishJobCollection extends Collection<PublishJob> {
  findByIdempotencyKey(organizationId: UUID, key: string): Promise<PublishJob | null>;
  claimDueJobs(nowIso: string, lockSeconds: number, limit: number): Promise<PublishJob[]>;
}

export interface CampaignPlan extends BaseRow {
  title: string;
  objective: string;
  audience: string;
  channels: string[];
  messages: string[];
  timeline: string[];
  success_measures: string[];
  created_by: UUID | null;
}

export interface VisualConcept extends BaseRow {
  title: string;
  purpose: string;
  formats: string[];
  message_hierarchy: string[];
  asset_list: string[];
  accessibility_notes: string[];
  brand_consistency_notes: string[];
  created_by: UUID | null;
}

export interface SocialPlan extends BaseRow {
  title: string;
  platforms: string[];
  cadence: string;
  themes: string[];
  content_pillars: string[];
  created_by: UUID | null;
}

export interface CommunityPlan extends BaseRow {
  title: string;
  channels: string[];
  response_guidelines: string[];
  escalation_rules: string[];
  engagement_rituals: string[];
  created_by: UUID | null;
}

export interface QualityReport extends BaseRow {
  subject: string;
  passed: boolean;
  score: number;
  blocking: boolean;
  findings: unknown;
  created_by: UUID | null;
}

export interface EmailSequence extends BaseRow {
  name: string;
  trigger: string;
  steps: Array<{ id: string; delayDays: number; templateId: UUID | null; subject: string }>;
  stop_conditions: string[];
  status: 'draft' | 'active' | 'paused' | 'completed';
  created_by: UUID | null;
}

export interface MemoryRecord extends BaseRow {
  scope: string;
  key: string;
  value: unknown;
  created_by: UUID | null;
}

export interface NotificationRow extends Notification, BaseRow {}

export interface NibrexoRepository {
  readonly backend: 'supabase' | 'memory';

  clients: Collection<Client>;
  clientActivity: Collection<ClientActivity>;
  mediaFiles: Collection<MediaFile>;
  leads: Collection<Lead>;
  contentItems: Collection<ContentItem>;
  emailTemplates: Collection<EmailTemplate>;
  emailLogs: Collection<EmailLog>;
  emailSequences: Collection<EmailSequence>;
  /** Phase 16 — visual email designs saved by the studio or the Manager. */
  emailDesigns: Collection<EmailDesign>;
  /** Phase 16 — one organization-level brand + design-system profile. */
  emailBrandProfiles: Collection<EmailBrandProfileRecord>;
  socialAccounts: Collection<SocialAccount>;
  socialCredentials: Collection<SocialCredential>;
  socialOauthStates: Collection<SocialOAuthState>;
  publishJobs: PublishJobCollection;
  /** Normalized inbox persistence, provider IDs/cursors, webhook receipts and reply idempotency. */
  inbox: InboxDataAccess;
  researchBriefs: Collection<ResearchBrief>;
  productConcepts: Collection<ProductConcept>;
  visualConcepts: Collection<VisualConcept>;
  campaignPlans: Collection<CampaignPlan>;
  socialPlans: Collection<SocialPlan>;
  communityPlans: Collection<CommunityPlan>;
  qualityReports: Collection<QualityReport>;
  approvals: Collection<ApprovalRecord>;
  activityLogs: Collection<ActivityLog & BaseRow>;
  notifications: Collection<NotificationRow>;
  memory: Collection<MemoryRecord>;

  /** Manager task persistence (PDF #05 §8 ai_tasks). */
  tasks: {
    create(task: ManagerTaskSnapshot): Promise<ManagerTaskSnapshot>;
    get(id: UUID, organizationId: UUID): Promise<ManagerTaskSnapshot | null>;
    update(id: UUID, organizationId: UUID, patch: Partial<ManagerTaskSnapshot>): Promise<ManagerTaskSnapshot | null>;
    list(organizationId: UUID, options?: ListOptions): Promise<ManagerTaskSnapshot[]>;
  };

  /** Aggregates used by the business-reporting skill. No estimation, no gaps filled. */
  counts(organizationId: UUID): Promise<Record<string, number>>;
}

export interface Notification {
  organization_id: UUID;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'error';
  read: boolean;
  created_by: UUID | null;
}
