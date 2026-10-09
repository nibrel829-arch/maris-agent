/**
 * NIBREXO CEO / MANAGER AGENT — orchestration types.
 *
 * The Manager is ONE central decision-making brain. Skills are capabilities it
 * selects and invokes; they are NOT independent agents (CEO spec §2, §6).
 *
 * Compatibility decision (documented in docs/ARCHITECTURE.md):
 *  - PDF #08 §16 defines the persisted agent state machine (`ManagerTaskState`).
 *  - CEO spec §6 defines the reasoning pipeline.
 * We persist PDF #08 states as the authoritative task status and record the
 * CEO pipeline as `ManagerStage` entries inside the task trace. The documented
 * state machine is therefore preserved, not replaced.
 */

import type {
  ActivityAction,
  ActorContext,
  ApprovalRecord,
  RiskLevel,
  UUID,
} from './domain';

/* -------------------------------------------------------------------------- */
/* Stage / pipeline                                                            */
/* -------------------------------------------------------------------------- */

export type ManagerStage =
  | 'understand'
  | 'classify'
  | 'plan'
  | 'select_skills'
  | 'execute'
  | 'verify'
  | 'quality_control'
  | 'deliver'
  | 'next_best_action';

export const MANAGER_STAGE_ORDER: readonly ManagerStage[] = [
  'understand',
  'classify',
  'plan',
  'select_skills',
  'execute',
  'verify',
  'quality_control',
  'deliver',
  'next_best_action',
];

/* -------------------------------------------------------------------------- */
/* Request classification                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Business domains the Manager coordinates. Derived from CEO spec §2.
 */
export type WorkType =
  | 'strategy'
  | 'research'
  | 'dental_research'
  | 'product_development'
  | 'visual_communication'
  | 'content'
  | 'marketing'
  | 'lead_generation'
  | 'lead_qualification'
  | 'sales'
  | 'outreach'
  | 'email_workflow'
  | 'social_media'
  | 'community_management'
  | 'business_operations'
  | 'quality_control'
  | 'reporting'
  | 'memory_continuity'
  | 'decision_making'
  | 'general_orchestration';

export type DeliverableKind =
  | 'research_brief'
  | 'product_concept'
  | 'content_draft'
  | 'visual_concept'
  | 'campaign_plan'
  | 'lead_list'
  | 'qualification_assessment'
  | 'sales_plan'
  | 'outreach_draft'
  | 'email_draft'
  | 'email_sequence'
  | 'social_plan'
  | 'community_plan'
  | 'operations_plan'
  | 'quality_report'
  | 'business_report'
  | 'decision_memo'
  | 'direct_answer';

export interface ManagerIntent {
  /** Dominant work type for this request. */
  primary: WorkType;
  /** Additional work types the Manager must also cover. */
  secondary: WorkType[];
  /** Rewritten, unambiguous statement of what the user wants. */
  objective: string;
  /** What must physically exist when the task is done. */
  deliverable: DeliverableKind;
  /** 0-1. Low confidence escalates instead of guessing (CEO spec §7). */
  confidence: number;
  /** Matched lexical signals that produced this classification. */
  signals: string[];
  /** True when the request touches dental/medical subject matter. */
  medicalDomain: boolean;
  /** True when the request asks the system to state facts about the world. */
  requiresEvidence: boolean;
}

export interface UnderstoodRequest {
  request: string;
  objective: string;
  entities: Record<string, string[]>;
  constraints: string[];
  missingInformation: string[];
  assumptions: string[];
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

export type SkillId =
  | 'manager-orchestration'
  | 'research-intelligence'
  | 'dental-research'
  | 'product-development'
  | 'visual-content'
  | 'content-marketing'
  | 'lead-generation'
  | 'sales-outreach-email'
  | 'social-community'
  | 'quality-control'
  | 'business-reporting';

export type ModuleId =
  | 'dashboard'
  | 'social'
  | 'content'
  | 'inbox'
  | 'clients'
  | 'email'
  | 'ai'
  | 'settings';

export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  /** Work types this skill can serve. */
  workTypes: WorkType[];
  /** Modules this skill needs access to. */
  modules: ModuleId[];
  /** Tools this skill is allowed to invoke (must exist in the tool registry). */
  tools: string[];
  /** Reference documents in the knowledge layer. */
  knowledge: string[];
  /** Delivery shape this skill produces. */
  outputs: DeliverableKind[];
  /** Highest risk this skill can reach; drives approval policy. */
  maxRisk: RiskLevel;
  /** Version of the skill definition. */
  version: string;
}

/* -------------------------------------------------------------------------- */
/* Tools (PDF #08 §5 — explicit schemas, declared permissions)                 */
/* -------------------------------------------------------------------------- */

export interface ToolContext {
  actor: ActorContext;
  taskId: UUID;
  organizationId: UUID;
  /** Tenant-scoped persistence. Every tool writes through this boundary. */
  repo: import('@/server/db/types').NibrexoRepository;
  /** Correlation id propagated to logs and external adapters. */
  runId: string;
  /** Idempotency key — retries must not duplicate external actions. */
  idempotencyKey: string;
  stepId?: string;
  signal?: AbortSignal;
  /** Optional live update while a long tool, such as image generation, is running. */
  onProgress?: (update: { stage: string; message: string; step?: number; total?: number }) => void;
}

export interface ToolPermission {
  module: ModuleId;
  action: 'view' | 'create' | 'edit' | 'delete' | 'publish' | 'send' | 'approve';
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  /** Declared up front and enforced by the permission guard. */
  permission: ToolPermission;
  risk: RiskLevel;
  /** Zod schema — unknown/invalid input is rejected, never coerced silently. */
  inputSchema: {
    safeParse: (value: unknown) =>
      | { success: true; data: TInput }
      | { success: false; error: { message: string } };
  };
  /** True when the tool performs an external, irreversible or paid action. */
  external: boolean;
  execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

/* -------------------------------------------------------------------------- */
/* Plan                                                                        */
/* -------------------------------------------------------------------------- */

export interface PlanStep {
  id: string;
  /** Human-readable description shown in the workspace. */
  title: string;
  rationale: string;
  skillId: SkillId;
  toolName: string | null;
  input: Record<string, unknown>;
  /** Populated by the approval engine; null means no approval was needed. */
  requiresApproval: boolean;
  risk: RiskLevel;
  /** Stage of the CEO pipeline this step belongs to. */
  stage: ManagerStage;
  dependsOn: string[];
  /**
   * Set when the Manager cannot supply a mandatory input from the request.
   * The step is skipped (not guessed) and surfaced as an open question.
   */
  clarification: string | null;
}

export interface ManagerPlan {
  goal: string;
  steps: PlanStep[];
  /** Skills selected, in order of use. */
  skills: SkillId[];
  /** Approximation only — surfaced as an estimate, never as a fact. */
  estimatedSteps: number;
  /** Anything the Manager needs from the user before it can finish. */
  openQuestions: string[];
  /** Which planner produced this: deterministic rules or the AI layer. */
  planner: 'deterministic' | 'ai';
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'denied'
  | 'blocked';

/** How completely the requested work finished. Distinct from the PDF state machine. */
export type TaskCompletion =
  | 'complete'
  | 'partial'
  | 'failed'
  | 'awaiting_approval'
  | 'cancelled';

export interface OutputReference {
  kind: 'content_item' | 'research_brief' | 'product_concept' | 'visual_concept' | 'media_file' | 'quality_report';
  id: string;
  label: string;
  /** In-app path. Null when the record has no detail route. */
  href: string | null;
}

export type ErrorClass =
  | 'validation'
  | 'permission'
  | 'auth'
  | 'not_configured'
  | 'unsupported'
  | 'rate_limit'
  | 'network'
  | 'server'
  | 'unknown';

export interface ManagerIssue {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  /** True when the same operation may be safely retried. */
  retryable: boolean;
  errorClass: ErrorClass;
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  toolName: string | null;
  output: unknown;
  issues: ManagerIssue[];
  approval: Pick<ApprovalRecord, 'id' | 'status' | 'expires_at'> | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
}

/* -------------------------------------------------------------------------- */
/* Verification / quality control                                              */
/* -------------------------------------------------------------------------- */

export interface VerificationResult {
  ok: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
  issues: ManagerIssue[];
}

export interface QualityControlResult {
  passed: boolean;
  /** 0-100. */
  score: number;
  findings: Array<{
    id: string;
    severity: 'info' | 'warning' | 'error';
    rule: string;
    detail: string;
    remediation: string;
  }>;
  /** Blocks delivery when true. */
  blocking: boolean;
}

/* -------------------------------------------------------------------------- */
/* Task result                                                                 */
/* -------------------------------------------------------------------------- */

export type ClaimLabel = 'FACT' | 'EVIDENCE' | 'INTERPRETATION' | 'RECOMMENDATION';
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unverified';

export interface ManagerArtifact {
  kind: DeliverableKind;
  title: string;
  /** Structured content of the deliverable. */
  content: unknown;
  /** Sections the Manager could not verify with real sources. */
  uncertainties: string[];
  /** Labeled claims so downstream consumers can see provenance. */
  claims: Array<{
    label: ClaimLabel;
    statement: string;
    source: string | null;
    confidence: ConfidenceLevel;
  }>;
}

export interface ManagerResult {
  taskId: UUID;
  state: 'COMPLETED' | 'FAILED' | 'WAITING_APPROVAL' | 'CANCELLED';
  /**
   * Honest finish line. `partial` means some steps produced saved output and
   * others failed, were blocked, or remain assisted. Never treat partial as done.
   */
  completion: TaskCompletion;
  summary: string;
  /** Saved records the operator can open. Empty when nothing was persisted. */
  references: OutputReference[];
  artifacts: ManagerArtifact[];
  quality: QualityControlResult | null;
  verification: VerificationResult | null;
  nextBestAction: NextBestAction[];
  approvals: Array<Pick<ApprovalRecord, 'id' | 'action' | 'risk' | 'status' | 'expires_at'>>;
  issues: ManagerIssue[];
  /** False when no AI provider key was configured — never emulated. */
  aiEnabled: boolean;
  completedAt: string;
}

export interface NextBestAction {
  title: string;
  rationale: string;
  /** Skill that would perform this action. */
  skillId: SkillId;
  /** True when the action needs a human decision before it runs. */
  requiresApproval: boolean;
}

export interface ManagerTraceEntry {
  stage: ManagerStage;
  at: string;
  message: string;
  data?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Persistence contract                                                        */
/* -------------------------------------------------------------------------- */

export type ManagerTaskRecordState =
  | 'RECEIVED'
  | 'PLANNING'
  | 'WAITING_APPROVAL'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ManagerTaskSnapshot {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  request: string;
  state: ManagerTaskRecordState;
  intent: ManagerIntent | null;
  plan: ManagerPlan | null;
  stepResults: StepResult[];
  trace: ManagerTraceEntry[];
  result: ManagerResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type { ActivityAction, ActorContext, ApprovalRecord, RiskLevel };
