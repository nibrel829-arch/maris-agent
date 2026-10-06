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

export type ClientStatus = 'lead' | 'qualified' | 'active' | 'paused' | 'churned';

export interface Client {
  id: UUID;
  organization_id: UUID;
  name: string;
  company: string | null;
  email: string | null;
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

export interface EmailTemplate {
  id: UUID;
  organization_id: UUID;
  name: string;
  category: string;
  subject: string;
  body: string;
  variables: string[];
  archived: boolean;
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
  error_message: string | null;
  created_by: UUID | null;
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
  | 'manager.task.completed'
  | 'manager.task.failed'
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
  | 'email.prepared'
  | 'email.sent'
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
