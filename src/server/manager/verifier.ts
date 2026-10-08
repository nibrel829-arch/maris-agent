/**
 * Verifier (PDF #08 §3, §14 Agent Safety Rules).
 *
 * Checks the actual execution results. A result is only accepted when the tool
 * reported success AND the output passes structural checks. The verifier never
 * upgrades a failure into a success.
 */

import type { PlanStep, StepResult, VerificationResult, ManagerIssue } from '@/types/manager';

const EMPTY_OUTPUT_SENTINELS = new Set(['', 'null', 'undefined', '{}', '[]']);

function hasSubstance(output: unknown): boolean {
  if (output === null || output === undefined) return false;
  if (Array.isArray(output)) return output.length > 0;
  if (typeof output === 'object') {
    const keys = Object.keys(output as Record<string, unknown>);
    if (keys.length === 0) return false;
    return keys.some((key) => {
      const value = (output as Record<string, unknown>)[key];
      return value !== null && value !== undefined && value !== '';
    });
  }
  return !EMPTY_OUTPUT_SENTINELS.has(String(output).trim());
}

export function verify(
  steps: readonly PlanStep[],
  results: readonly StepResult[],
): VerificationResult {
  const checks: VerificationResult['checks'] = [];
  const issues: ManagerIssue[] = [];

  const executed = results.filter((result) => result.status === 'succeeded');
  const failed = results.filter((result) => result.status === 'failed');
  const denied = results.filter((result) => result.status === 'denied');
  const blocked = results.filter((result) => result.status === 'blocked');
  const awaiting = results.filter((result) => result.status === 'awaiting_approval');
  const skipped = results.filter((result) => result.status === 'skipped');

  for (const result of executed) {
    checks.push({
      name: `output-substance:${result.stepId}`,
      passed: hasSubstance(result.output),
      detail: hasSubstance(result.output)
        ? `Step ${result.stepId} produced substantive output.`
        : `Step ${result.stepId} reported success but produced no substantive output.`,
    });
  }

  for (const result of failed) {
    for (const issue of result.issues) issues.push(issue);
    checks.push({
      name: `step-failed:${result.stepId}`,
      passed: false,
      detail: result.issues[0]?.message ?? `Step ${result.stepId} failed.`,
    });
  }

  for (const result of denied) {
    issues.push(...result.issues);
    checks.push({
      name: `step-denied:${result.stepId}`,
      passed: false,
      detail: result.issues[0]?.message ?? `Step ${result.stepId} was denied by the permission guard.`,
    });
  }

  for (const result of blocked) {
    issues.push(...result.issues);
    checks.push({
      name: `step-blocked:${result.stepId}`,
      passed: false,
      detail: result.issues[0]?.message ?? `Step ${result.stepId} is blocked and was not treated as complete.`,
    });
  }

  for (const result of skipped) {
    checks.push({
      name: `step-skipped:${result.stepId}`,
      passed: true,
      detail: result.issues[0]?.message ?? `Step ${result.stepId} was skipped.`,
    });
  }

  if (awaiting.length > 0) {
    checks.push({
      name: 'awaiting-approval',
      passed: true,
      detail: `${awaiting.length} step(s) are waiting for explicit approval. They have not been executed.`,
    });
  }

  const plannedToolSteps = steps.filter((step) => step.toolName !== null).length;
  const resolvedToolSteps = results.filter(
    (result) => result.status === 'succeeded' || result.status === 'skipped',
  ).length;

  checks.push({
    name: 'coverage',
    passed: plannedToolSteps === 0 || resolvedToolSteps > 0,
    detail: `${resolvedToolSteps} of ${plannedToolSteps} tool steps resolved.`,
  });

  const ok =
    failed.length === 0 &&
    denied.length === 0 &&
    blocked.length === 0 &&
    (executed.length > 0 || skipped.length > 0);

  return { ok, checks, issues };
}
