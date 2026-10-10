/**
 * Truthful task outcome (Phase 17).
 *
 * A task is COMPLETED only when every planned tool step succeeded, verification
 * passed and at least one deliverable was generated. Every other end state is
 * derived from the recorded step results, never from the absence of an error:
 *
 *   FAILED           a step failed, quality blocked delivery, verification failed,
 *                    or nothing was delivered
 *   BLOCKED          a step was denied by permission, or a provider is not configured
 *   WAITING_APPROVAL an external action is held for an explicit human decision
 *   NEEDS_INPUT      a step was skipped because the user has not answered a question
 *   COMPLETED        everything above is clear and verification passed
 *
 * Precedence is FAILED > BLOCKED > WAITING_APPROVAL > NEEDS_INPUT > COMPLETED.
 * The function is pure so the rules can be tested without a database.
 */

import type {
  ManagerIssue,
  PlanStep,
  QualityControlResult,
  StepResult,
  VerificationResult,
} from '@/types/manager';

export type OutcomeState = 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'WAITING_APPROVAL' | 'NEEDS_INPUT';

export interface OutcomeReason {
  code: string;
  stepId: string | null;
  message: string;
}

export interface OutcomeQuestion {
  stepId: string;
  field: string | null;
  question: string;
}

export interface OutcomeInput {
  steps: readonly PlanStep[];
  results: readonly StepResult[];
  pendingApprovalCount: number;
  haltedOnApproval: { stepId: string } | null;
  haltedOnError: { stepId: string; issue: ManagerIssue } | null;
  verification: VerificationResult;
  quality: QualityControlResult | null;
  deliverableCount: number;
}

export interface TaskOutcome {
  state: OutcomeState;
  reasons: OutcomeReason[];
  questions: OutcomeQuestion[];
}

/** Error classes that mean "this cannot proceed as things stand", not a crash. */
const BLOCKING_CLASSES = new Set(['not_configured', 'auth', 'permission', 'unsupported']);

export function deriveOutcome(input: OutcomeInput): TaskOutcome {
  const reasons: OutcomeReason[] = [];
  const questions: OutcomeQuestion[] = [];

  const failed = input.results.filter((result) => result.status === 'failed');
  const denied = input.results.filter((result) => result.status === 'denied');
  const skipped = input.results.filter((result) => result.status === 'skipped');

  // FAILED — execution errors that are not "blocked by configuration".
  for (const result of failed) {
    const issue = result.issues[0];
    if (issue && BLOCKING_CLASSES.has(issue.errorClass)) continue;
    reasons.push({
      code: issue?.code ?? 'STEP_FAILED',
      stepId: result.stepId,
      message: issue?.message ?? `Step ${result.stepId} failed.`,
    });
  }
  if (input.quality?.blocking) {
    reasons.push({
      code: 'QUALITY_BLOCKED',
      stepId: null,
      message: 'Quality control blocked delivery. Resolve the findings and retry.',
    });
  }
  if (reasons.length > 0) return { state: 'FAILED', reasons, questions };

  // BLOCKED — configuration, permission or unsupported capability.
  for (const result of failed) {
    const issue = result.issues[0];
    if (!issue || !BLOCKING_CLASSES.has(issue.errorClass)) continue;
    reasons.push({ code: issue.code, stepId: result.stepId, message: issue.message });
  }
  for (const result of denied) {
    const issue = result.issues[0];
    reasons.push({
      code: issue?.code ?? 'PERMISSION_DENIED',
      stepId: result.stepId,
      message: issue?.message ?? 'Your role does not allow this step.',
    });
  }
  if (reasons.length > 0) return { state: 'BLOCKED', reasons, questions };

  // WAITING_APPROVAL — a human decision is required before the work can continue.
  if (input.haltedOnApproval || input.pendingApprovalCount > 0) {
    return {
      state: 'WAITING_APPROVAL',
      reasons: [
        {
          code: 'APPROVAL_REQUIRED',
          stepId: input.haltedOnApproval?.stepId ?? null,
          message: 'An external action is waiting for an explicit approval. Nothing external has been done.',
        },
      ],
      questions,
    };
  }

  // NEEDS_INPUT — essential information is missing. Never a completion.
  for (const result of skipped) {
    const step = input.steps.find((candidate) => candidate.id === result.stepId);
    const issue = result.issues[0];
    const question = step?.clarification ?? issue?.message ?? `Step ${result.stepId} needs more information.`;
    questions.push({
      stepId: result.stepId,
      field: step?.clarificationField ?? null,
      question,
    });
  }
  if (questions.length > 0) {
    return {
      state: 'NEEDS_INPUT',
      reasons: questions.map((entry) => ({
        code: 'NEEDS_CLARIFICATION',
        stepId: entry.stepId,
        message: entry.question,
      })),
      questions,
    };
  }

  // FAILED — the work did not verify, or produced nothing.
  if (!input.verification.ok) {
    const failedCheck = input.verification.checks.find((check) => !check.passed);
    const issue = input.verification.issues[0];
    return {
      state: 'FAILED',
      reasons: [
        {
          code: 'VERIFICATION_FAILED',
          stepId: null,
          message:
            failedCheck?.detail ??
            issue?.message ??
            'Verification did not pass. The output is not marked complete.',
        },
      ],
      questions,
    };
  }
  if (input.deliverableCount === 0) {
    return {
      state: 'FAILED',
      reasons: [
        {
          code: 'NO_DELIVERABLE',
          stepId: null,
          message: 'No deliverable was generated from the executed steps, so the task is not complete.',
        },
      ],
      questions,
    };
  }

  return { state: 'COMPLETED', reasons: [], questions };
}
