/**
 * Nibrexo OS AI — core domain types.
 *
 * Source of truth: PDF #05 (Database Architecture & Supabase Schema),
 * PDF #04 (Feature Specification + Roles & Permissions), PDF #12 §7
 * (Database Master Scope).
 *
 * Every organization-owned record is tenant scoped and protected by RLS
 * plus server-side authorization.
 */

export type UUID = string;
export type ISODateTime = string;

/* -------------------------------------------------------------------------- */
/* Identity / tenancy                                                          */
/* -------------------------------------------------------------------------- */

export type OrgRole = 'owner' | 'admin' | 'member' | 'client';

export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Profile {
  id: UUID;
  full_name: string | null;
  avatar_url: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Membership {
  id: UUID;
  organization_id: UUID;
  user_id: UUID;
  role: OrgRole;
  created_at: ISODateTime;
}

/** Resolved identity used by every server-side operation. */
export interface ActorContext {
  userId: UUID;
  organizationId: UUID;
  role: OrgRole;
  email: string | null;
  fullName: string | null;
  /** True only when the identity came from the explicit dev escape hatch. */
  isDevIdentity: boolean;
}

/* -------------------------------------------------------------------------- */
/* CRM (PDF #05 §6)                                                            */
/* -------------------------------------------------------------------------- */

export type ClientStatus =
  | 'lead'
  | 'prospect'
  | 'qualified'
  | 'active'
  | 'paused'
  | 'inactive'
  | 'churned'
  | 'completed';

export interface Client {
  id: UUID;
  organization_id: UUID;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  tags: string[];
  notes: string | null;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type ClientActivityKind =
  | 'note'
  | 'email'
  | 'call'
  | 'meeting'
  | 'status_change'
  | 'lead_created'
  | 'lead_qualified'
  | 'task';

export interface ClientActivity {
  id: UUID;
  organization_id: UUID;
  client_id: UUID;
  kind: ClientActivityKind;
  subject: string;
  body: string | null;
  actor_id: UUID | null;
  created_at: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* Leads (lead-generation / qualification skills)                             */
/* -------------------------------------------------------------------------- */

export type LeadStage =
  | 'identified'
  | 'researched'
  | 'contacted'
  | 'qualified'
  | 'disqualified'
  | 'converted';

export interface Lead {
  id: UUID;
  organization_id: UUID;
  client_id: UUID | null;
  name: string;
  company: string | null;
  email: string | null;
  source: string | null;
  stage: LeadStage;
  /** 0-100. Never invented — derived only from recorded evidence. */
  qualification_score: number;
  qualification_reasons: string[];
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* Content (PDF #05 §5)                                                        */
/* -------------------------------------------------------------------------- */

export type ContentStatus =
  | 'DRAFT'
  | 'VALIDATING'
  | 'READY'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export interface MediaFile {
  id: UUID;
  organization_id: UUID;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
  task_id?: UUID | null;
  step_id?: string | null;
  provider?: string | null;
  model?: string | null;
  prompt?: string | null;
  negative_prompt?: string | null;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
}

export interface ContentItem {
  id: UUID;
  organization_id: UUID;
  title: string;
  caption: string | null;
  body: string | null;
  status: ContentStatus;
  platforms: string[];
  media_url: string | null;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* Social (PDF #09 §5)                                                         */
/* -------------------------------------------------------------------------- */

export type SocialPlatform =
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'contra';

export type ConnectionStatus =
  | 'connected'
  | 'reconnect_required'
  | 'disconnected'
  | 'pending';

export interface SocialAccount {
  id: UUID;
  organization_id: UUID;
  platform: SocialPlatform;
  external_account_id: string;
  name: string;
  status: ConnectionStatus;
  /** Capability map — only what the official API actually supports. */
  capabilities: SocialCapabilities;
  connected_by: UUID | null;
  /** Safe user-facing failure text. Never contains secrets. */
  last_error: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/**
 * Provider token material. Tokens exist here ONLY as AES-256-GCM ciphertext
 * (`*_encrypted`); `credential_ref` records the key version (`v1`).
 * Admin-only at the RLS layer (0005) and never selected for browser paths.
 */
export interface SocialCredential {
  id: UUID;
  organization_id: UUID;
  account_id: UUID;
  credential_ref: string;
  scopes: string[];
  expires_at: ISODateTime | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_type: string;
  refresh_expires_at: ISODateTime | null;
  last_refreshed_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/**
 * Single-use OAuth `state` rows. Only the sha256 hash is stored; `payload`
 * may carry encrypted interim data (Facebook Page selection) and never
 * plaintext secrets.
 */
export interface SocialOAuthState {
  id: UUID;
  organization_id: UUID;
  platform: SocialPlatform;
  state_hash: string;
  redirect_uri: string;
  requested_by: UUID | null;
  payload: Record<string, unknown> | null;
  expires_at: ISODateTime;
  used_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface SocialCapabilities {
  publish: boolean;
  schedule: boolean;
  readDm: boolean;
  sendDm: boolean;
  readComments: boolean;
  replyComments: boolean;
  analytics: boolean;
}

/* -------------------------------------------------------------------------- */
/* Publishing (PDF #12 §17; migration 0009)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Per-target publish lifecycle. Terminal states: published, failed, unknown,
 * cancelled. `unknown` means the provider gave an ambiguous result (poll
 * budget exhausted, unreadable response) — it is reported as unknown, never
 * rounded up to published.
 */
export type PublishJobStatus =
  | 'queued'
  | 'publishing'
  | 'verifying'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'unknown'
  | 'cancelled';

/** How a published job was confirmed (see migration 0009). */
export type PublishVerification = 'read_back' | 'provider_reference';

/**
 * Frozen publish snapshot stored on the job at creation. Later content edits
 * never change a scheduled post. Never contains tokens or secrets.
 */
export interface PublishPayloadSnapshot {
  title: string;
  caption: string;
  /** Attached library media, when the publish carries media. */
  mediaId: string | null;
  mediaKind: 'image' | 'video' | null;
  mediaMime: string | null;
  mediaSizeBytes: number | null;
  /** External media URL (agent/tools path or absolute content URL). No bytes. */
  mediaExternalUrl: string | null;
  /** Library image used as the Pinterest video-Pin cover. */
  coverMediaId: string | null;
  /** External link for link-style posts (Facebook), when supplied. */
  linkUrl: string | null;
  /** Per-target provider options (board id, privacy, category...). */
  options: Record<string, string | boolean>;
}

/**
 * Interim NON-SECRET provider state carried across sweeps (container ids,
 * publish ids, upload ids). Upload URLs, tokens and secrets are never stored.
 */
export interface PublishProviderState {
  /** Provider reference for the in-flight operation (container/publish/media id). */
  ref?: string;
  /** Provider step reached (submit/poll/verify), per adapter. */
  step?: string;
  /** Durable provider post id once the provider returns one. */
  postId?: string;
  /** Poll round for async providers. */
  pollRound?: number;
  [key: string]: unknown;
}

export interface PublishJob {
  id: UUID;
  organization_id: UUID;
  content_id: UUID;
  account_id: UUID;
  platform: SocialPlatform;
  status: PublishJobStatus;
  verification: PublishVerification | null;
  run_at: ISODateTime;
  timezone: string;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  provider_ref: string | null;
  provider_payload: PublishProviderState;
  payload: PublishPayloadSnapshot;
  last_error: string | null;
  next_poll_at: ISODateTime | null;
  locked_at: ISODateTime | null;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* Email (PDF #10 §17)                                                         */
/* -------------------------------------------------------------------------- */

export type EmailStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'FAILED'
  | 'CANCELLED';

export type EmailTemplateStatus = 'draft' | 'active' | 'archived';

export interface EmailTemplate {
  id: UUID;
  organization_id: UUID;
  name: string;
  category: string;
  subject: string;
  body: string;
  variables: string[];
  archived: boolean;
  /** Lifecycle for Phase 10: draft templates are not selectable for sending. Defaults to active in DB. */
  status?: EmailTemplateStatus;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface EmailLog {
  id: UUID;
  organization_id: UUID;
  client_id: UUID | null;
  template_id: UUID | null;
  to_email: string;
  subject: string;
  body: string;
  status: EmailStatus;
  provider_message_id: string | null;
  /** Provider name that delivered this row (e.g. resend) — null when unsent. */
  provider?: string | null;
  /** Idempotency guard for retry-safe sends (24h Resend window + local dedup). */
  idempotency_key?: string | null;
  /** Frozen template snapshot at send time (subject/body/variables). */
  template_snapshot?: Record<string, unknown> | null;
  error_message: string | null;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type EmailSequenceStatus = 'draft' | 'active' | 'paused' | 'archived' | 'completed';

export interface EmailSequenceStepDefinition {
  templateId: UUID;
  delayDays: number;
  delayHours: number;
}

export interface EmailSequence {
  id: UUID;
  organization_id: UUID;
  name: string;
  description?: string | null;
  trigger: string;
  steps: EmailSequenceStepDefinition[];
  stop_conditions: string[];
  status: EmailSequenceStatus;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'unsubscribed' | 'bounced' | 'failed';

export interface EmailSequenceEnrollment {
  id: UUID;
  organization_id: UUID;
  sequence_id: UUID;
  client_id: UUID | null;
  email: string;
  status: EnrollmentStatus;
  current_step: number;
  next_run_at: ISODateTime | null;
  enrolled_by: UUID | null;
  enrolled_at: ISODateTime;
  completed_at: ISODateTime | null;
  cancelled_at: ISODateTime | null;
  last_error: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type EmailJobStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'skipped';

export interface EmailJob {
  id: UUID;
  organization_id: UUID;
  sequence_id: UUID | null;
  enrollment_id: UUID | null;
  client_id: UUID | null;
  step_id: UUID | null;
  to_email: string | null;
  template_id: UUID | null;
  variables: Record<string, string>;
  idempotency_key: string;
  run_at: ISODateTime;
  status: EmailJobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_retry_at: ISODateTime | null;
  locked_at: ISODateTime | null;
  provider_message_id: string | null;
  provider: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface EmailPreference {
  id: UUID;
  organization_id: UUID;
  email: string;
  opted_out: boolean;
  opted_out_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* AI / Manager persistence (PDF #05 §8, PDF #08)                              */
/* -------------------------------------------------------------------------- */

export type ManagerTaskState =
  | 'RECEIVED'
  | 'PLANNING'
  | 'WAITING_APPROVAL'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ManagerTaskRecord {
  id: UUID;
  organization_id: UUID;
  user_id: UUID;
  request: string;
  state: ManagerTaskState;
  plan: unknown;
  intent: unknown;
  result: unknown;
  trace: unknown[];
  error: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface ApprovalRecord {
  id: UUID;
  organization_id: UUID;
  task_id: UUID | null;
  step_id: string | null;
  action: string;
  tool_name: string;
  risk: RiskLevel;
  reason: string;
  summary: string;
  payload: unknown;
  status: ApprovalStatus;
  requested_by: UUID | null;
  decided_by: UUID | null;
  decision_note: string | null;
  /** Expired approvals cannot be reused (PDF #08 §8). */
  expires_at: ISODateTime;
  decided_at: ISODateTime | null;
  created_at: ISODateTime;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export type ActivityAction =
  | 'manager.task.created'
  | 'manager.task.resumed'
  | 'manager.task.completed'
  | 'manager.task.failed'
  | 'manager.task.cancelled'
  | 'manager.task.retried'
  | 'research.sources_recorded'
  | 'manager.step.executed'
  | 'manager.step.denied'
  | 'manager.approval.requested'
  | 'manager.approval.decided'
  | 'client.created'
  | 'client.updated'
  | 'lead.created'
  | 'lead.qualified'
  | 'content.created'
  | 'content.updated'
  | 'content.deleted'
  | 'media.uploaded'
  | 'media.deleted'
  | 'social.account.connected'
  | 'social.account.disconnected'
  | 'social.account.refreshed'
  | 'publish.job.created'
  | 'publish.job.published'
  | 'publish.job.failed'
  | 'publish.job.cancelled'
  | 'inbox.conversation.updated'
  | 'inbox.reply.draft_saved'
  | 'inbox.reply.failed'
  | 'inbox.reply.sent'
  | 'inbox.sync.completed'
  | 'inbox.sync.failed'
  | 'email.template.created'
  | 'email.template.updated'
  | 'email.template.deleted'
  | 'email.prepared'
  | 'email.sent'
  | 'email.failed'
  | 'email.sequence.created'
  | 'email.sequence.updated'
  | 'email.sequence.deleted'
  | 'email.sequence.started'
  | 'email.sequence.paused'
  | 'email.sequence.resumed'
  | 'email.sequence.archived'
  | 'email.sequence.enrolled'
  | 'email.sequence.cancelled'
  | 'email.sequence.completed'
  | 'report.generated'
  | 'research.brief_created'
  | 'quality.check_run'
  | 'settings.updated';

export interface ActivityLog {
  id: UUID;
  organization_id: UUID;
  actor_id: UUID | null;
  action: ActivityAction;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* Research artifacts (research-intelligence / dental-research skills)          */
/* -------------------------------------------------------------------------- */

export type EvidenceGrade = 'FACT' | 'EVIDENCE' | 'INTERPRETATION' | 'RECOMMENDATION';

export interface ResearchEvidence {
  /** What was found. */
  claim: string;
  /** How we know — required. Empty means the claim cannot be asserted. */
  source: string | null;
  grade: EvidenceGrade;
  /** 0-1 — must be surfaced, never hidden (CEO spec §8). */
  confidence: number;
  /** Populated when the claim could not be verified with a real source. */
  uncertainty: string | null;
}

export interface ResearchBrief {
  id: UUID;
  organization_id: UUID;
  topic: string;
  domain: 'general' | 'dental' | 'market' | 'product' | 'competitor';
  question: string;
  structure: string[];
  evidence: ResearchEvidence[];
  gaps: string[];
  recommendations: string[];
  medical_review_required: boolean;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/* -------------------------------------------------------------------------- */
/* Product development (product-development skill)                             */
/* -------------------------------------------------------------------------- */

export interface ProductConcept {
  id: UUID;
  organization_id: UUID;
  name: string;
  target_customer: string;
  problem: string;
  demand_signal: string | null;
  alternatives: string[];
  missing_opportunity: string;
  scope: string[];
  components: string[];
  versions: string[];
  file_types: string[];
  differentiation: string[];
  pricing_considerations: string[];
  open_questions: string[];
  created_by: UUID | null;
  created_at: ISODateTime;
}
