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
import { buildPlan, refinePlanWithAi } from './planner';
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
const CONTROL_TOOLS = new Set(['run_quality_check', 'run_medical_safety_check']);

/** Maps a tool output key onto a human-readable deliverable label. */
const ENTITY_LABELS: Record<string, string> = {
  brief: 'Research brief',
  concept: 'Product concept',
  contentItem: 'Content item',
  emailLog: 'Email draft',
  template: 'Email template',
  sequence: 'Email sequence',
  lead: 'Lead',
  client: 'Client',
  report: 'Report',
  memo: 'Decision memo',
  campaignPlan: 'Campaign plan',
  socialPlan: 'Social plan',
  communityPlan: 'Community plan',
};

const ENTITY_KEYS = Object.keys(ENTITY_LABELS);

function buildArtifacts(
  steps: readonly PlanStep[],
  results: readonly StepResult[],
  deliverable: DeliverableKind,
): { artifacts: ManagerArtifact[]; uncertainties: string[] } {
  const artifacts: ManagerArtifact[] = [];
  const uncertainties: string[] = [];

  for (const result of results) {
    if (result.status !== 'succeeded' || result.output === null) continue;
    const step = steps.find((candidate) => candidate.id === result.stepId);
    if (!step) continue;
    if (step.toolName && CONTROL_TOOLS.has(step.toolName)) continue;

    const output = result.output as Record<string, unknown> | null;

    // Explicit uncertainty signals raised by tools.
    const gaps = output && Array.isArray(output.gaps) ? (output.gaps as string[]) : [];
    const missing = output && Array.isArray(output.missingData) ? (output.missingData as string[]) : [];
    const openQuestions =
      output && Array.isArray(output.openQuestions) ? (output.openQuestions as string[]) : [];
    uncertainties.push(...gaps, ...missing, ...openQuestions);

    const record = output ?? {};
    const entityKey = ENTITY_KEYS.find((key) => record[key] !== undefined && record[key] !== null);
    const entity = (entityKey ? (record[entityKey] as Record<string, unknown>) : record) ?? {};

    const rawTitle =
      (typeof entity.topic === 'string' && entity.topic) ||
      (typeof entity.name === 'string' && entity.name) ||
      (typeof entity.title === 'string' && entity.title) ||
      (typeof entity.subject === 'string' && entity.subject) ||
      step.title;

    const label = entityKey ? ENTITY_LABELS[entityKey] : 'Output';
    const title = `${label}: ${String(rawTitle).slice(0, 160)}`;

    // Merge repeated records for the same deliverable instead of listing them twice.
    const existing = artifacts.find(
      (candidate) => candidate.kind === deliverable && candidate.title === title,
    );
    const claims = claimsFromOutput(result.output);

    if (existing) {
      existing.uncertainties = [
        ...new Set([...existing.uncertainties, ...gaps, ...missing, ...openQuestions]),
      ];
      existing.claims = [...existing.claims, ...claims];
      continue;
    }

    artifacts.push({
      kind: deliverable,
      title,
      content: result.output,
      uncertainties: [...gaps, ...missing, ...openQuestions],
      claims,
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

export async function resumeManagerTask(params: {
  taskId: UUID;
  actor: ActorContext;
  repo: NibrexoRepository;
}): Promise<ManagerTaskSnapshot> {
  const { taskId, actor, repo } = params;
  const snapshot = await repo.tasks.get(taskId, actor.organizationId);
  if (!snapshot) {
    throw new Error('Task not found or not in this organization.');
  }
  if (!snapshot.plan || !snapshot.intent) {
    throw new Error('Task has no plan to resume.');
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
    trace('execute', 'Task resumed after an approval decision.'),
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

  /* ---- Stage 6: VERIFY --------------------------------------------------- */
  snapshot = await persist(repo, { ...snapshot, state: 'VERIFYING', trace: [...traceLog] });
  const verification: VerificationResult = verify(plan.steps, outcome.stepResults);
  traceLog.push(
    trace('verify', verification.ok ? 'Verification passed.' : 'Verification reported issues.', {
      checks: verification.checks.length,
      issues: verification.issues.length,
    }),
  );

  /* ---- Stage 7: QUALITY CONTROL ------------------------------------------ */
  const quality = qualityFromResults(outcome.stepResults);
  traceLog.push(
    trace('quality_control', quality ? `Quality score ${quality.score}.` : 'No quality-control output recorded.', {
      blocking: quality?.blocking ?? false,
    }),
  );

  /* ---- Stage 8-9: DELIVER + NEXT BEST ACTION ----------------------------- */
  const approvals = (await repo.approvals.list(snapshot.organizationId, { limit: 200 })).filter(
    (approval) => approval.task_id === snapshot.id,
  );

  const { artifacts, uncertainties } = buildArtifacts(plan.steps, outcome.stepResults, intent.deliverable);

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');

  // A task with an undecided approval is never reported as complete, even if
  // the remaining independent steps finished.
  const state: ManagerTaskSnapshot['state'] =
    outcome.haltedOnApproval || pendingApprovals.length > 0
      ? 'WAITING_APPROVAL'
      : outcome.haltedOnError || quality?.blocking
        ? 'FAILED'
        : 'COMPLETED';

  const result: ManagerResult = {
    taskId: snapshot.id,
    state:
      state === 'WAITING_APPROVAL' ? 'WAITING_APPROVAL' : state === 'FAILED' ? 'FAILED' : 'COMPLETED',
    summary: buildSummary(intent, plan, outcome.stepResults, quality, state),
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      uncertainties: [...new Set([...artifact.uncertainties, ...uncertainties])],
    })),
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

  traceLog.push(trace('deliver', `Task ${state}.`, { summary: result.summary }));
  traceLog.push(
    trace('next_best_action', `${result.nextBestAction.length} recommended follow-up action(s).`),
  );

  const finalSnapshot = await persist(repo, {
    ...snapshot,
    state,
    stepResults: outcome.stepResults,
    trace: traceLog,
    result,
    error: outcome.haltedOnError ? outcome.haltedOnError.issue.message : null,
  });

  await writeAudit(repo, actor, {
    action: state === 'COMPLETED' ? 'manager.task.completed' : 'manager.task.failed',
    entityType: 'manager_task',
    entityId: snapshot.id,
    metadata: { state, aiEnabled: result.aiEnabled },
  });

  return finalSnapshot;
}

function buildSummary(
  intent: ManagerIntent,
  plan: ManagerPlan,
  results: readonly StepResult[],
  quality: QualityControlResult | null,
  state: ManagerTaskSnapshot['state'],
): string {
  const succeeded = results.filter((result) => result.status === 'succeeded').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const awaiting = results.filter((result) => result.status === 'awaiting_approval').length;
  const failed = results.filter((result) => result.status === 'failed').length;

  const parts = [
    `Classified as ${intent.primary.replace(/_/g, ' ')} (confidence ${(intent.confidence * 100).toFixed(0)}%).`,
    `Planned ${plan.steps.length} step(s) across ${plan.skills.length} skill(s).`,
    `${succeeded} executed, ${skipped} skipped for missing input, ${awaiting} awaiting approval, ${failed} failed.`,
  ];

  if (quality) parts.push(`Quality score ${quality.score}/100${quality.blocking ? ' with blocking findings' : ''}.`);

  if (state === 'WAITING_APPROVAL') {
    parts.push('Work is paused until the pending approval is decided. No external action has been taken.');
  } else if (state === 'FAILED') {
    parts.push('The task stopped before completion; see the reported issues.');
  } else {
    parts.push('Delivered. Prepared actions are marked as prepared, not completed.');
  }

  return parts.join(' ');
}

export type { ManagerTaskSnapshot };
