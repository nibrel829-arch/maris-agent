/**
 * NIBREXO CEO / MANAGER — central orchestrator.
 *
 * Pipeline (CEO spec §6), persisted as the PDF #08 §16 state machine:
 *
 *   RECEIVED -> understand -> classify -> plan -> select skills
 *            -> PLANNING -> permission guard -> EXECUTING -> verify
 *            -> quality control -> deliver -> next best action -> COMPLETED
 *
 * There is exactly ONE Manager. Skills are capabilities selected by this
 * orchestrator; they cannot self-initiate, escalate their own permissions or
 * bypass approvals.
 */

import { newId } from '@/lib/id';
import type { ActorContext, ApprovalRecord, UUID } from '@/types/domain';
import type { NibrexoRepository } from '@/server/db/types';
import type {
  DeliverableKind,
  ManagerArtifact,
  ManagerArtifactRecord,
  ManagerClarification,
  ManagerIntent,
  ManagerPlan,
  ManagerResult,
  ManagerStage,
  ManagerTaskSnapshot,
  ManagerTraceEntry,
  NextBestAction,
  PlanStep,
  QualityControlResult,
  StepResult,
  VerificationResult,
} from '@/types/manager';
import { isAiEnabled } from '@/server/ai/client';
import { writeAudit } from './audit';
import { executeSteps } from './execution-engine';
import { buildClarifications, buildPlan, refinePlanWithAi } from './planner';
import type { ClarificationAnswers } from './planner';
import { buildDeliverableSpecs } from './deliverables';
import { deriveOutcome } from './outcome';
import { persistDeliverables, toSummary } from '@/server/artifacts/service';
import { renderDesignDocument } from '@/server/email/design-service';
import { getSkill } from './skill-registry';
import { classify, understand } from './understand';
import { verify } from './verifier';
import { isExpired } from './approval-policy';

export interface OrchestratorInput {
  request: string;
  actor: ActorContext;
  repo: NibrexoRepository;
  signal?: AbortSignal;
}

const nowIso = (): string => new Date().toISOString();

function trace(stage: ManagerStage, message: string, data?: unknown): ManagerTraceEntry {
  return { stage, at: nowIso(), message, ...(data !== undefined ? { data } : {}) };
}

/* -------------------------------------------------------------------------- */
/* Artifacts                                                                   */
/* -------------------------------------------------------------------------- */

function claimsFromOutput(output: unknown): ManagerArtifact['claims'] {
  const claims: ManagerArtifact['claims'] = [];

  const walk = (value: unknown, prefix = ''): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${prefix}[${index}]`));
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.claim === 'string') {
        claims.push({
          label: (record.grade as ManagerArtifact['claims'][number]['label']) ?? 'INTERPRETATION',
          statement: record.claim,
          source: typeof record.source === 'string' ? record.source : null,
          confidence:
            typeof record.confidence === 'number'
              ? record.confidence >= 0.75
                ? 'high'
                : record.confidence >= 0.45
                  ? 'medium'
                  : record.confidence > 0
                    ? 'low'
                    : 'unverified'
              : 'unverified',
        });
      }
      for (const [key, nested] of Object.entries(record)) walk(nested, `${prefix}.${key}`);
    }
  };

  walk(output);
  return claims;
}

/**
 * Control steps (quality control, medical screening) produce findings, not
 * deliverables — their output feeds the quality result instead.
 */
/**
 * Structured content of the steps that produced deliverables. It mirrors the
 * tool output so consumers (reports page, API readers) see the real record.
 */
function buildArtifacts(
  steps: readonly PlanStep[],
  results: readonly StepResult[],
  deliverable: DeliverableKind,
  deliverableStepIds: ReadonlySet<string>,
): { artifacts: ManagerArtifact[]; uncertainties: string[] } {
  const artifacts: ManagerArtifact[] = [];
  const uncertainties: string[] = [];

  for (const result of results) {
    if (result.status !== 'succeeded' || result.output === null) continue;
    if (!deliverableStepIds.has(result.stepId)) continue;
    const step = steps.find((candidate) => candidate.id === result.stepId);
    if (!step) continue;

    const output = result.output as Record<string, unknown>;
    const gaps = Array.isArray(output.gaps) ? (output.gaps as string[]) : [];
    const missing = Array.isArray(output.missingData) ? (output.missingData as string[]) : [];
    const openQuestions = Array.isArray(output.openQuestions) ? (output.openQuestions as string[]) : [];
    uncertainties.push(...gaps, ...missing, ...openQuestions);

    artifacts.push({
      kind: deliverable,
      title: step.title,
      content: result.output,
      uncertainties: [...gaps, ...missing, ...openQuestions],
      claims: claimsFromOutput(result.output),
    });
  }

  return { artifacts, uncertainties: [...new Set(uncertainties)] };
}

/* -------------------------------------------------------------------------- */
/* Quality control extraction                                                  */
/* -------------------------------------------------------------------------- */

function qualityFromResults(results: readonly StepResult[]): QualityControlResult | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index];
    if (!result || result.status !== 'succeeded') continue;
    const output = result.output as Record<string, unknown> | null;
    if (!output || typeof output !== 'object') continue;
    if (typeof output.blocking === 'boolean' && typeof output.score === 'number') {
      return {
        passed: Boolean(output.passed),
        score: Number(output.score),
        blocking: Boolean(output.blocking),
        findings: Array.isArray(output.findings)
          ? (output.findings as QualityControlResult['findings'])
          : [],
      };
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Next best action                                                            */
/* -------------------------------------------------------------------------- */

function nextBestActions(
  plan: ManagerPlan,
  results: readonly StepResult[],
  quality: QualityControlResult | null,
  approvals: readonly ApprovalRecord[],
): NextBestAction[] {
  const actions: NextBestAction[] = [];

  for (const approval of approvals.filter((entry) => entry.status === 'pending')) {
    actions.push({
      title: `Review and decide: ${approval.action}`,
      rationale: approval.reason,
      skillId: 'manager-orchestration',
      requiresApproval: true,
    });
  }

  for (const result of results) {
    if (result.status !== 'skipped') continue;
    const message = result.issues[0]?.message ?? 'This step needs more information.';
    actions.push({
      title: `Provide missing input for: ${result.stepId}`,
      rationale: message,
      skillId: 'manager-orchestration',
      requiresApproval: false,
    });
  }

  if (quality?.blocking) {
    for (const finding of quality.findings.filter((entry) => entry.severity === 'error')) {
      actions.push({
        title: `Resolve quality finding: ${finding.rule}`,
        rationale: finding.remediation,
        skillId: 'quality-control',
        requiresApproval: false,
      });
    }
  }

  for (const question of plan.openQuestions.slice(0, 5)) {
    actions.push({
      title: `Answer: ${question}`,
      rationale: 'The Manager recorded this as an open question rather than guessing.',
      skillId: 'manager-orchestration',
      requiresApproval: false,
    });
  }

  if (actions.length === 0) {
    actions.push({
      title: 'Proceed with the delivered output',
      rationale: 'No blocking findings were recorded for this task.',
      skillId: 'manager-orchestration',
      requiresApproval: false,
    });
  }

  return actions.slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

async function persist(
  repo: NibrexoRepository,
  snapshot: ManagerTaskSnapshot,
): Promise<ManagerTaskSnapshot> {
  const updated = await repo.tasks.update(snapshot.id, snapshot.organizationId, snapshot);
  return updated ?? snapshot;
}

export async function runManagerTask(input: OrchestratorInput): Promise<ManagerTaskSnapshot> {
  const { request, actor, repo } = input;
  const taskId = newId();
  const runId = newId();
  const traceLog: ManagerTraceEntry[] = [trace('understand', 'Manager received the request.')];

  let snapshot: ManagerTaskSnapshot = {
    id: taskId,
    organizationId: actor.organizationId,
    userId: actor.userId,
    request,
    state: 'RECEIVED',
    intent: null,
    plan: null,
    stepResults: [],
    trace: traceLog,
    result: null,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  snapshot = await repo.tasks.create(snapshot);
  await writeAudit(repo, actor, {
    action: 'manager.task.created',
    entityType: 'manager_task',
    entityId: taskId,
    metadata: { requestLength: request.length },
  });

  /* ---- Stage 1: UNDERSTAND ---------------------------------------------- */
  const understood = understand(request);
  traceLog.push(
    trace('understand', 'Request parsed into objective, entities, constraints and gaps.', {
      entities: understood.entities,
      missingInformation: understood.missingInformation,
    }),
  );

  /* ---- Stage 2: CLASSIFY ------------------------------------------------- */
  const intent: ManagerIntent = classify(request, understood);
  traceLog.push(
    trace('classify', `Classified as "${intent.primary}" with confidence ${intent.confidence.toFixed(2)}.`, {
      secondary: intent.secondary,
      deliverable: intent.deliverable,
      medicalDomain: intent.medicalDomain,
      signals: intent.signals,
    }),
  );

  snapshot = await persist(repo, { ...snapshot, intent, trace: [...traceLog] });

  /* ---- Stage 3-4: PLAN + SELECT SKILLS ---------------------------------- */
  snapshot = await persist(repo, { ...snapshot, state: 'PLANNING', trace: [...traceLog] });

  let plan = buildPlan(intent, understood);
  const refinement = await refinePlanWithAi(plan, intent);
  plan = refinement.plan;

  traceLog.push(
    trace('plan', `Plan created with ${plan.steps.length} step(s) using the ${plan.planner} planner.`, {
      refinement: refinement.note,
      openQuestions: plan.openQuestions,
    }),
  );
  traceLog.push(
    trace('select_skills', `Skills selected: ${plan.skills.join(', ')}.`, {
      skills: plan.skills.map((skillId) => getSkill(skillId)?.name ?? skillId),
    }),
  );

  snapshot = await persist(repo, { ...snapshot, plan, trace: [...traceLog] });

  return executeAndFinalise(snapshot, intent, plan, { actor, repo, taskId, runId, signal: input.signal });
}

/** Thrown when a resume or answer is not valid for the task's current state. */
export class ManagerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagerConflictError';
  }
}

/** States a user can continue. COMPLETED and in-flight states are refused. */
const RESUMABLE_STATES = new Set<ManagerTaskSnapshot['state']>([
  'WAITING_APPROVAL',
  'NEEDS_INPUT',
  'BLOCKED',
  'FAILED',
]);

/** Answers keyed by clarification field, read from the stored plan. */
export function answersFromPlan(plan: ManagerPlan): ClarificationAnswers {
  const answers: ClarificationAnswers = {};
  for (const clarification of plan.clarifications ?? []) {
    if (clarification.answer !== null) answers[clarification.field] = clarification.answer;
  }
  return answers;
}

/**
 * Applies the user's answers to the stored plan and re-plans the same step
 * structure with real values. Unknown fields are rejected: an answer can only
 * resolve a question the Manager actually asked.
 */
export function applyAnswers(
  plan: ManagerPlan,
  request: string,
  intent: ManagerIntent,
  answers: Record<string, string>,
): ManagerPlan {
  const open = new Map((plan.clarifications ?? []).map((item) => [item.field, item]));
  const now = nowIso();
  const existing = new Map((plan.clarifications ?? []).map((item) => [item.field, item]));

  for (const [field, raw] of Object.entries(answers)) {
    const question = open.get(field);
    if (!question) {
      throw new ManagerConflictError(`The Manager did not ask for "${field}". Answer one of the open questions.`);
    }
    const value = raw.trim();
    if (value.length === 0) throw new ManagerConflictError('An answer cannot be empty.');
    existing.set(field, { ...question, answer: value.slice(0, 2000), answeredAt: now });
  }

  const understood = understand(request);
  const rebuilt = buildPlan(intent, understood, answersFromClarificationMap(existing));
  // Answered questions stay in the plan as history with their answers. A
  // question the rebuilt plan still raises is open again even when it was
  // answered: e.g. sources supplied with no sourced claim. Its earlier answer
  // is not treated as satisfying the step, so the user is asked again.
  const raised = new Map(buildClarifications(rebuilt.steps).map((item) => [item.field, item]));
  const merged = new Map<string, ManagerClarification>();
  for (const [field, item] of existing) {
    const again = raised.get(field);
    merged.set(field, again ? { ...again, id: item.id, answer: null, answeredAt: null } : item);
  }
  for (const [field, item] of raised) {
    if (!merged.has(field)) merged.set(field, item);
  }
  return {
    ...rebuilt,
    planner: plan.planner,
    clarifications: [...merged.values()],
  };
}

function answersFromClarificationMap(map: Map<string, ManagerClarification>): ClarificationAnswers {
  const answers: ClarificationAnswers = {};
  for (const item of map.values()) {
    if (item.answer !== null) answers[item.field] = item.answer;
  }
  return answers;
}

export async function resumeManagerTask(params: {
  taskId: UUID;
  actor: ActorContext;
  repo: NibrexoRepository;
  /** User answers to open clarifications, keyed by field. */
  answers?: Record<string, string>;
}): Promise<ManagerTaskSnapshot> {
  const { taskId, actor, repo } = params;
  const snapshot = await repo.tasks.get(taskId, actor.organizationId);
  if (!snapshot) {
    throw new Error('Task not found or not in this organization.');
  }
  if (!snapshot.plan || !snapshot.intent) {
    throw new Error('Task has no plan to resume.');
  }
  if (!RESUMABLE_STATES.has(snapshot.state)) {
    throw new ManagerConflictError(
      `This task is ${snapshot.state.toLowerCase().replace(/_/g, ' ')} and cannot be resumed.`,
    );
  }

  // Answers re-plan the task so the answered steps run with real input.
  if (params.answers && Object.keys(params.answers).length > 0) {
    const replanned = applyAnswers(snapshot.plan, snapshot.request, snapshot.intent, params.answers);
    snapshot.plan = replanned;
    snapshot.trace = [
      ...snapshot.trace,
      trace('plan', `Answers received for ${Object.keys(params.answers).join(', ')}. Plan rebuilt with the supplied input.`),
    ];
  }

  // Drop approval holds that are no longer pending (decided, expired, rejected).
  const approvals = await repo.approvals.list(actor.organizationId, { limit: 200 });
  const relevant = approvals.filter((approval) => approval.task_id === taskId);

  // Steps whose approval was granted and has not expired: their placeholder
  // result is dropped so the step executes, and the granted approval is passed
  // to the engine so the gate is not applied a second time.
  const approvedStepIds = relevant
    .filter((entry) => entry.status === 'approved' && !isExpired(entry.expires_at))
    .map((entry) => entry.step_id)
    .filter((stepId): stepId is string => typeof stepId === 'string');

  const stepResults: StepResult[] = snapshot.stepResults
    .filter(
      (result) => !(result.status === 'awaiting_approval' && approvedStepIds.includes(result.stepId)),
    )
    .map((result) => {
    if (result.status !== 'awaiting_approval' || !result.approval) return result;
    const approval = relevant.find((entry) => entry.id === result.approval?.id);
    if (!approval) return result;

    if (approval.status === 'rejected' || approval.status === 'cancelled') {
      return {
        ...result,
        status: 'denied' as const,
        issues: [
          {
            code: 'APPROVAL_REJECTED',
            message: 'The approval request was rejected. The action was not executed.',
            severity: 'warning' as const,
            retryable: false,
            errorClass: 'permission' as const,
          },
        ],
      };
    }
    if (isExpired(approval.expires_at)) {
      return {
        ...result,
        status: 'denied' as const,
        issues: [
          {
            code: 'APPROVAL_EXPIRED',
            message: 'The approval expired. Expired approvals cannot be reused.',
            severity: 'warning' as const,
            retryable: false,
            errorClass: 'permission' as const,
          },
        ],
      };
    }
    return result;
  });

  const traceLog = [
    ...snapshot.trace,
    trace('execute', 'Task resumed.', { previousState: snapshot.state }),
  ];

  return executeAndFinalise(
    { ...snapshot, stepResults, trace: traceLog },
    snapshot.intent,
    snapshot.plan,
    {
      actor,
      repo,
      taskId,
      runId: newId(),
      approvedStepIds,
    },
  );
}

async function executeAndFinalise(
  snapshot: ManagerTaskSnapshot,
  intent: ManagerIntent,
  plan: ManagerPlan,
  env: {
    actor: ActorContext;
    repo: NibrexoRepository;
    taskId: UUID;
    runId: string;
    approvedStepIds?: readonly string[];
    signal?: AbortSignal;
  },
): Promise<ManagerTaskSnapshot> {
  const traceLog = [...snapshot.trace];
  const { actor, repo } = env;

  /* ---- Stage 5: EXECUTE -------------------------------------------------- */
  snapshot = await persist(repo, { ...snapshot, state: 'EXECUTING', trace: [...traceLog] });

  const outcome = await executeSteps(plan.steps, {
    actor,
    repo,
    taskId: snapshot.id,
    runId: env.runId,
    organizationId: snapshot.organizationId,
    ...(env.approvedStepIds ? { approvedStepIds: env.approvedStepIds } : {}),
    ...(env.signal ? { signal: env.signal } : {}),
  }, { previous: snapshot.stepResults });

  for (const result of outcome.stepResults) {
    if (result.status === 'succeeded') {
      await writeAudit(repo, actor, {
        action: 'manager.step.executed',
        entityType: 'manager_task',
        entityId: snapshot.id,
        metadata: { stepId: result.stepId, tool: result.toolName, durationMs: result.durationMs },
      });
    }
    if (result.status === 'denied') {
      await writeAudit(repo, actor, {
        action: 'manager.step.denied',
        entityType: 'manager_task',
        entityId: snapshot.id,
        metadata: { stepId: result.stepId, tool: result.toolName, reason: result.issues[0]?.message },
      });
    }
  }

  traceLog.push(
    trace('execute', `Executed ${outcome.stepResults.length} step record(s).`, {
      haltedOnApproval: outcome.haltedOnApproval?.stepId ?? null,
      haltedOnError: outcome.haltedOnError?.stepId ?? null,
    }),
  );

  /* ---- Stage 6: DELIVERABLES + VERIFY ------------------------------------ */
  snapshot = await persist(repo, { ...snapshot, state: 'VERIFYING', trace: [...traceLog] });
  const generatedAt = nowIso();
  const specs = buildDeliverableSpecs({
    steps: plan.steps,
    results: outcome.stepResults,
    request: snapshot.request,
    generatedAt,
    renderEmailDesign: (design) => {
      const document = design.design as Parameters<typeof renderDesignDocument>[1] | undefined;
      if (!document) return null;
      return renderDesignDocument(snapshot.organizationId, document, {
        subject: typeof design.subject === 'string' ? design.subject : undefined,
      }).html;
    },
  });
  const verification: VerificationResult = verify(plan.steps, outcome.stepResults, {
    deliverableCount: specs.length,
  });
  traceLog.push(
    trace('verify', verification.ok ? 'Verification passed.' : 'Verification did not pass.', {
      checks: verification.checks.length,
      issues: verification.issues.length,
      deliverables: specs.length,
    }),
  );

  /* ---- Stage 7: QUALITY CONTROL ------------------------------------------ */
  const quality = qualityFromResults(outcome.stepResults);
  traceLog.push(
    trace('quality_control', quality ? `Quality score ${quality.score}.` : 'No quality-control output recorded.', {
      blocking: quality?.blocking ?? false,
    }),
  );

  /* ---- Decide the truthful end state ------------------------------------ */
  const approvals = (await repo.approvals.list(snapshot.organizationId, { limit: 200 })).filter(
    (approval) => approval.task_id === snapshot.id,
  );
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');

  let decided = deriveOutcome({
    steps: plan.steps,
    results: outcome.stepResults,
    pendingApprovalCount: pendingApprovals.length,
    haltedOnApproval: outcome.haltedOnApproval ? { stepId: outcome.haltedOnApproval.stepId } : null,
    haltedOnError: outcome.haltedOnError,
    verification,
    quality,
    deliverableCount: specs.length,
  });

  /* ---- Stage 8: DELIVER — persist files only for verified completion ---- */
  let deliverables: ManagerArtifactRecord[] = [];
  if (decided.state === 'COMPLETED') {
    try {
      deliverables = await persistDeliverables({
        repo,
        actor,
        taskId: snapshot.id,
        specs,
      });
      for (const record of deliverables) {
        await writeAudit(repo, actor, {
          action: 'manager.artifact.created',
          entityType: 'manager_task',
          entityId: snapshot.id,
          metadata: { artifactId: record.id, kind: record.kind, format: record.format, sizeBytes: record.size_bytes },
        });
      }
    } catch (error) {
      // A deliverable that cannot be stored is a failure, never a success.
      const message = error instanceof Error ? error.message : 'Unknown storage error.';
      decided = {
        state: 'FAILED',
        reasons: [
          {
            code: 'ARTIFACT_WRITE_FAILED',
            stepId: null,
            message: `The deliverable could not be saved: ${message}. Retry the task after checking the workspace storage.`,
          },
        ],
        questions: [],
      };
      deliverables = [];
    }
  }
  const state = decided.state;

  const deliverableStepIds = new Set(specs.map((spec) => spec.stepId));
  const { artifacts, uncertainties } = buildArtifacts(
    plan.steps,
    outcome.stepResults,
    intent.deliverable,
    state === 'COMPLETED' ? deliverableStepIds : new Set<string>(),
  );

  const result: ManagerResult = {
    taskId: snapshot.id,
    state,
    summary: buildSummary(intent, plan, outcome.stepResults, quality, state, decided.reasons.length),
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      uncertainties: [...new Set([...artifact.uncertainties, ...uncertainties])],
    })),
    deliverables: deliverables.map(toSummary),
    reasons: decided.reasons,
    quality,
    verification,
    nextBestAction: nextBestActions(plan, outcome.stepResults, quality, pendingApprovals),
    approvals: approvals.map((approval) => ({
      id: approval.id,
      action: approval.action,
      risk: approval.risk,
      status: approval.status,
      expires_at: approval.expires_at,
    })),
    issues: [
      ...verification.issues,
      ...(outcome.haltedOnError ? [outcome.haltedOnError.issue] : []),
    ],
    aiEnabled: isAiEnabled(),
    completedAt: nowIso(),
  };

  traceLog.push(trace('deliver', `Task ${state}.`, { summary: result.summary, reasons: decided.reasons.map((reason) => reason.code) }));
  traceLog.push(trace('next_best_action', `${result.nextBestAction.length} recommended follow-up action(s).`));

  const firstBlocking = decided.reasons[0];
  const finalSnapshot = await persist(repo, {
    ...snapshot,
    state,
    stepResults: outcome.stepResults,
    trace: traceLog,
    result,
    error: state === 'COMPLETED' || state === 'WAITING_APPROVAL' || state === 'NEEDS_INPUT' ? null : firstBlocking?.message ?? null,
  });

  await writeAudit(repo, actor, {
    action: AUDIT_ACTION_BY_STATE[state],
    entityType: 'manager_task',
    entityId: snapshot.id,
    metadata: { state, aiEnabled: result.aiEnabled, reasons: decided.reasons.map((reason) => reason.code), deliverables: deliverables.length },
  });

  return finalSnapshot;
}

const AUDIT_ACTION_BY_STATE: Record<ManagerTaskSnapshot['state'], string> = {
  RECEIVED: 'manager.task.queued',
  PLANNING: 'manager.task.planning',
  WAITING_APPROVAL: 'manager.task.waiting_approval',
  NEEDS_INPUT: 'manager.task.needs_input',
  BLOCKED: 'manager.task.blocked',
  EXECUTING: 'manager.task.executing',
  VERIFYING: 'manager.task.verifying',
  COMPLETED: 'manager.task.completed',
  FAILED: 'manager.task.failed',
  CANCELLED: 'manager.task.cancelled',
};

function buildSummary(
  intent: ManagerIntent,
  plan: ManagerPlan,
  results: readonly StepResult[],
  quality: QualityControlResult | null,
  state: ManagerTaskSnapshot['state'],
  reasonCount: number,
): string {
  const succeeded = results.filter((result) => result.status === 'succeeded').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const awaiting = results.filter((result) => result.status === 'awaiting_approval').length;
  const failed = results.filter((result) => result.status === 'failed' || result.status === 'denied').length;

  const parts = [
    `Classified as ${intent.primary.replace(/_/g, ' ')} (confidence ${(intent.confidence * 100).toFixed(0)}%).`,
    `Planned ${plan.steps.length} step(s) across ${plan.skills.length} skill(s).`,
    `${succeeded} executed, ${skipped} waiting for input, ${awaiting} awaiting approval, ${failed} failed or denied.`,
  ];

  if (quality) parts.push(`Quality score ${quality.score}/100${quality.blocking ? ' with blocking findings' : ''}.`);

  switch (state) {
    case 'COMPLETED':
      parts.push('Verified and delivered. The deliverables below were generated from the executed output.');
      break;
    case 'NEEDS_INPUT':
      parts.push(`Paused: ${reasonCount} question(s) must be answered before the work can finish. Nothing was guessed.`);
      break;
    case 'BLOCKED':
      parts.push('Blocked: a permission or configuration issue must be resolved before the work can continue.');
      break;
    case 'WAITING_APPROVAL':
      parts.push('Paused until the pending approval is decided. No external action has been taken.');
      break;
    case 'FAILED':
      parts.push('Not completed. See the reasons below. Failures are reported, never shown as success.');
      break;
    default:
      break;
  }
  return parts.join(' ');
}

export type { ManagerTaskSnapshot };
