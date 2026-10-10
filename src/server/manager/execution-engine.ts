/**
 * Execution Engine (PDF #08 §3, §5, §7, §8).
 *
 *   PERMISSION GUARD -> APPROVAL GATE -> INPUT VALIDATION -> TOOL EXECUTION
 *   -> STRUCTURED RESULT OR STRUCTURED FAILURE
 *
 * Rules enforced here:
 *  - Permission checks happen before tool execution and are authoritative.
 *  - AI cannot grant itself permission.
 *  - Unknown tools are rejected.
 *  - Steps that need clarification are skipped, never guessed.
 *  - External actions stop for approval.
 *  - Failed tools return structured, classified errors.
 */

import { newId } from '@/lib/id';
import { classifyError } from '@/lib/result';
import type { ActorContext, ApprovalRecord, UUID } from '@/types/domain';
import type { NibrexoRepository } from '@/server/db/types';
import type {
  ManagerIssue,
  PlanStep,
  StepResult,
  ToolContext,
} from '@/types/manager';
import { checkPermission } from '@/server/auth/permissions';
import { evaluateApproval } from './approval-policy';
import { getTool } from './tool-registry';
import { resolveStepReferences } from './input-resolver';

export interface ExecutionEnvironment {
  actor: ActorContext;
  repo: NibrexoRepository;
  taskId: UUID;
  runId: string;
  organizationId: UUID;
  /**
   * Steps whose approval has already been granted and verified. The gate is not
   * re-applied to them; a granted approval is consumed by exactly one execution.
   */
  approvedStepIds?: readonly string[];
  signal?: AbortSignal;
}

export interface ExecutionOutcome {
  stepResults: StepResult[];
  /** Set when the run stopped because an approval is required. */
  haltedOnApproval: { stepId: string; approvalId: UUID; approval: ApprovalRecord } | null;
  /** Set when the run stopped because of a non-retryable failure. */
  haltedOnError: { stepId: string; issue: ManagerIssue } | null;
}

function emptyResult(step: PlanStep, status: StepResult['status']): StepResult {
  const now = new Date().toISOString();
  return {
    stepId: step.id,
    status,
    toolName: step.toolName,
    output: null,
    issues: [],
    approval: null,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
  };
}

async function requestApproval(
  env: ExecutionEnvironment,
  step: PlanStep,
  decision: ReturnType<typeof evaluateApproval>,
): Promise<ApprovalRecord> {
  return env.repo.approvals.insert({
    organization_id: env.organizationId,
    task_id: env.taskId,
    step_id: step.id,
    action: step.title,
    tool_name: step.toolName ?? 'none',
    risk: decision.risk,
    reason: decision.reason,
    summary: step.rationale,
    payload: step.input,
    status: 'pending',
    requested_by: env.actor.userId,
    decided_by: null,
    decision_note: null,
    expires_at: decision.expiresAt,
    decided_at: null,
  } as never);
}

/**
 * Executes plan steps sequentially. `startFromStepId` resumes an approved run.
 * Completed steps recorded in `previous` are never re-executed.
 */
export async function executeSteps(
  steps: readonly PlanStep[],
  env: ExecutionEnvironment,
  options: { previous?: StepResult[]; startFromStepId?: string | null } = {},
): Promise<ExecutionOutcome> {
  const previous = options.previous ?? [];
  const completed = new Set(
    previous.filter((result) => result.status === 'succeeded').map((result) => result.stepId),
  );

  const results: StepResult[] = [...previous];
  let started = options.startFromStepId == null;

  // A step produces exactly one result per run: replace any placeholder entry
  // (pending / failed from a previous attempt) instead of appending a duplicate.
  const upsert = (result: StepResult): void => {
    const index = results.findIndex((candidate) => candidate.stepId === result.stepId);
    if (index >= 0) results[index] = result;
    else results.push(result);
  };

  for (const step of steps) {
    if (options.startFromStepId && step.id === options.startFromStepId) started = true;
    if (!started) continue;
    if (completed.has(step.id)) continue;

    // Steps already resolved as awaiting approval or denied are left as-is.
    const existing = results.find((result) => result.stepId === step.id);
    if (existing && (existing.status === 'awaiting_approval' || existing.status === 'denied')) {
      continue;
    }

    const startedAt = Date.now();
    const base: StepResult = {
      stepId: step.id,
      status: 'running',
      toolName: step.toolName,
      output: null,
      issues: [],
      approval: null,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: null,
      durationMs: 0,
    };

    const finish = (patch: Partial<StepResult>): StepResult => ({
      ...base,
      ...patch,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    });

    // 1. Unknown tool -> reject (PDF #12 §9).
    if (!step.toolName) {
      upsert(
        finish({
          status: 'failed',
          issues: [
            {
              code: 'UNKNOWN_TOOL',
              message: 'This step has no registered tool. The Manager cannot invent tools.',
              severity: 'error',
              retryable: false,
              errorClass: 'validation',
            },
          ],
        }),
      );
      continue;
    }

    const tool = getTool(step.toolName);
    if (!tool) {
      upsert(
        finish({
          status: 'failed',
          issues: [
            {
              code: 'UNKNOWN_TOOL',
              message: `Tool "${step.toolName}" is not registered. Unknown tools are rejected.`,
              severity: 'error',
              retryable: false,
              errorClass: 'validation',
            },
          ],
        }),
      );
      continue;
    }

    // 2. Permission guard — authoritative, before anything else.
    const permission = checkPermission(env.actor, tool.permission, env.organizationId);
    if (!permission.allowed) {
      upsert(
        finish({
          status: 'denied',
          issues: [
            {
              code: 'PERMISSION_DENIED',
              message: permission.reason,
              severity: 'error',
              retryable: false,
              errorClass: 'permission',
            },
          ],
        }),
      );
      continue;
    }

    // 3. Clarification gate — skip rather than guess.
    if (step.clarification) {
      upsert(
        finish({
          status: 'skipped',
          issues: [
            {
              code: 'NEEDS_CLARIFICATION',
              message: step.clarification,
              severity: 'warning',
              retryable: false,
              errorClass: 'validation',
            },
          ],
        }),
      );
      continue;
    }

    // 4. Approval gate — external/high-risk actions stop here.
    const decision = evaluateApproval(tool.name, tool.risk, tool.permission.action);
    const alreadyApproved = (env.approvedStepIds ?? []).includes(step.id);
    if (decision.required && !alreadyApproved) {
      const approval = await requestApproval(env, step, decision);
      upsert(
        finish({
          status: 'awaiting_approval',
          approval: { id: approval.id, status: approval.status, expires_at: approval.expires_at },
        }),
      );
      return { stepResults: results, haltedOnApproval: { stepId: step.id, approvalId: approval.id, approval }, haltedOnError: null };
    }

    // 5. Resolve references to earlier step outputs, then validate.
    const { input: resolvedInput, unresolved } = resolveStepReferences(step.input, results);

    if (unresolved.length > 0) {
      upsert(
        finish({
          status: 'skipped',
          issues: unresolved.map((detail) => ({
            code: 'MISSING_DEPENDENCY',
            message: detail,
            severity: 'warning' as const,
            retryable: false,
            errorClass: 'validation' as const,
          })),
        }),
      );
      continue;
    }

    const parsed = tool.inputSchema.safeParse(resolvedInput);
    if (!parsed.success) {
      upsert(
        finish({
          status: 'failed',
          issues: [
            {
              code: 'INVALID_INPUT',
              message: `Input validation failed for ${tool.name}: ${parsed.error.message}`,
              severity: 'error',
              retryable: false,
              errorClass: 'validation',
            },
          ],
        }),
      );
      continue;
    }

    // 6. Execute.
    const context: ToolContext = {
      actor: env.actor,
      taskId: env.taskId,
      organizationId: env.organizationId,
      repo: env.repo,
      runId: env.runId,
      idempotencyKey: `idem_${env.taskId}:${step.id}`,
      ...(env.signal ? { signal: env.signal } : {}),
    };

    try {
      const output = await tool.execute(parsed.data as never, context);
      // A tool that reports its own provider/configuration failure as data is a
      // failed step, never a success (Phase 17: `send_email` returned
      // `status: 'not_configured'` and was recorded as succeeded).
      const interpreted = interpretToolOutput(output);
      if (interpreted) {
        upsert(finish({ status: 'failed', output, issues: [interpreted] }));
        if (!interpreted.retryable) {
          return { stepResults: results, haltedOnApproval: null, haltedOnError: { stepId: step.id, issue: interpreted } };
        }
        continue;
      }
      upsert(finish({ status: 'succeeded', output }));
    } catch (error) {
      const issue = classifyError(error);
      upsert(finish({ status: 'failed', issues: [issue] }));

      // Non-retryable failures stop the run; the plan is not continued blindly.
      if (!issue.retryable) {
        return { stepResults: results, haltedOnApproval: null, haltedOnError: { stepId: step.id, issue } };
      }
    }
  }

  return { stepResults: results, haltedOnApproval: null, haltedOnError: null };
}

/**
 * Tools return provider outcomes as data. These statuses mean the external or
 * configured capability did not perform the action. Domain statuses such as
 * `DRAFT`, `SENT` or `skipped` (already sent) are not failures.
 */
export function interpretToolOutput(output: unknown): ManagerIssue | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const status = record.status;
  if (status !== 'failed' && status !== 'not_configured' && status !== 'unsupported') return null;

  const reason =
    (typeof record.reason === 'string' && record.reason) ||
    (typeof record.message === 'string' && record.message) ||
    null;
  const retryable = record.retryable === true;

  if (status === 'not_configured') {
    return {
      code: 'NOT_CONFIGURED',
      message: reason ?? 'This capability is not configured for this environment.',
      severity: 'warning',
      retryable: false,
      errorClass: 'not_configured',
    };
  }
  if (status === 'unsupported') {
    return {
      code: 'UNSUPPORTED',
      message: reason ?? 'The official platform does not support this action.',
      severity: 'warning',
      retryable: false,
      errorClass: 'unsupported',
    };
  }
  return {
    code: 'PROVIDER_FAILED',
    message: reason ?? 'The provider rejected the action. Nothing was delivered.',
    severity: 'error',
    retryable,
    errorClass: retryable ? 'network' : 'server',
  };
}

export { emptyResult, newId };
