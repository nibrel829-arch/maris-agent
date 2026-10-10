import { describe, expect, it } from 'vitest';
import { deriveOutcome, type OutcomeInput } from '@/server/manager/outcome';
import { interpretToolOutput } from '@/server/manager/execution-engine';
import { verify } from '@/server/manager/verifier';
import type { PlanStep, StepResult } from '@/types/manager';

const step = (id: string, extra: Partial<PlanStep> = {}): PlanStep => ({
  id,
  title: `Step ${id}`,
  rationale: '',
  skillId: 'research-intelligence',
  toolName: 'create_research_brief',
  input: {},
  requiresApproval: false,
  risk: 'low',
  stage: 'execute',
  dependsOn: [],
  clarification: null,
  ...extra,
});

const result = (stepId: string, status: StepResult['status'], output: unknown = { ok: true }, issues: StepResult['issues'] = []): StepResult => ({
  stepId,
  status,
  toolName: 'create_research_brief',
  output,
  issues,
  approval: null,
  startedAt: '2026-10-10T00:00:00.000Z',
  finishedAt: '2026-10-10T00:00:01.000Z',
  durationMs: 1,
});

const verified = { ok: true, checks: [], issues: [] };

function input(overrides: Partial<OutcomeInput> = {}): OutcomeInput {
  return {
    steps: [step('step-1')],
    results: [result('step-1', 'succeeded')],
    pendingApprovalCount: 0,
    haltedOnApproval: null,
    haltedOnError: null,
    verification: verified,
    quality: null,
    deliverableCount: 1,
    ...overrides,
  };
}

describe('deriveOutcome — truthful end states (Phase 17)', () => {
  it('is COMPLETED only when every step succeeded, verified and a deliverable exists', () => {
    expect(deriveOutcome(input()).state).toBe('COMPLETED');
  });

  it('never reports COMPLETED when a step was skipped for missing input', () => {
    const outcome = deriveOutcome(
      input({
        steps: [step('step-1', { clarification: 'Who is the audience?', clarificationField: 'audience' })],
        results: [result('step-1', 'skipped', null, [{ code: 'NEEDS_CLARIFICATION', message: 'Who is the audience?', severity: 'warning', retryable: false, errorClass: 'validation' }])],
        deliverableCount: 0,
      }),
    );
    expect(outcome.state).toBe('NEEDS_INPUT');
    expect(outcome.questions).toEqual([{ stepId: 'step-1', field: 'audience', question: 'Who is the audience?' }]);
  });

  it('reports a failed step as FAILED with the step and its actionable message', () => {
    const outcome = deriveOutcome(
      input({
        results: [result('step-1', 'failed', null, [{ code: 'PROVIDER_FAILED', message: 'Provider rejected the message.', severity: 'error', retryable: false, errorClass: 'server' }])],
        haltedOnError: { stepId: 'step-1', issue: { code: 'PROVIDER_FAILED', message: 'Provider rejected the message.', severity: 'error', retryable: false, errorClass: 'server' } },
      }),
    );
    expect(outcome.state).toBe('FAILED');
    expect(outcome.reasons[0]).toMatchObject({ code: 'PROVIDER_FAILED', stepId: 'step-1' });
  });

  it('reports an unconfigured provider as BLOCKED, not FAILED', () => {
    const outcome = deriveOutcome(
      input({
        results: [result('step-1', 'failed', null, [{ code: 'NOT_CONFIGURED', message: 'Email provider is not configured.', severity: 'warning', retryable: false, errorClass: 'not_configured' }])],
        haltedOnError: { stepId: 'step-1', issue: { code: 'NOT_CONFIGURED', message: 'Email provider is not configured.', severity: 'warning', retryable: false, errorClass: 'not_configured' } },
      }),
    );
    expect(outcome.state).toBe('BLOCKED');
    expect(outcome.reasons[0]?.message).toMatch(/not configured/);
  });

  it('reports a permission denial as BLOCKED', () => {
    const outcome = deriveOutcome(input({ results: [result('step-1', 'denied', null, [{ code: 'PERMISSION_DENIED', message: 'Role cannot create.', severity: 'error', retryable: false, errorClass: 'permission' }])], deliverableCount: 0 }));
    expect(outcome.state).toBe('BLOCKED');
  });

  it('waits for approval and never completes while an approval is pending', () => {
    const outcome = deriveOutcome(input({ results: [result('step-1', 'awaiting_approval')], pendingApprovalCount: 1, haltedOnApproval: { stepId: 'step-1' }, deliverableCount: 0 }));
    expect(outcome.state).toBe('WAITING_APPROVAL');
  });

  it('fails when verification did not pass, even if every step reported success', () => {
    const outcome = deriveOutcome(
      input({
        verification: { ok: false, checks: [{ name: 'output-substance:step-1', passed: false, detail: 'Step step-1 reported success but produced no substantive output.' }], issues: [] },
      }),
    );
    expect(outcome.state).toBe('FAILED');
    expect(outcome.reasons[0]?.message).toMatch(/no substantive output/);
  });

  it('fails when no deliverable was generated', () => {
    const outcome = deriveOutcome(input({ deliverableCount: 0 }));
    expect(outcome.state).toBe('FAILED');
    expect(outcome.reasons[0]?.code).toBe('NO_DELIVERABLE');
  });

  it('fails when quality control blocks delivery', () => {
    const outcome = deriveOutcome(
      input({ quality: { score: 40, passed: false, blocking: true, findings: [] } as never }),
    );
    expect(outcome.state).toBe('FAILED');
    expect(outcome.reasons[0]?.code).toBe('QUALITY_BLOCKED');
  });

  it('gives FAILED precedence over NEEDS_INPUT when both are present', () => {
    const outcome = deriveOutcome(
      input({
        steps: [step('step-1'), step('step-2', { clarification: 'Who?', clarificationField: 'audience' })],
        results: [
          result('step-1', 'failed', null, [{ code: 'PROVIDER_FAILED', message: 'boom', severity: 'error', retryable: false, errorClass: 'server' }]),
          result('step-2', 'skipped', null, [{ code: 'NEEDS_CLARIFICATION', message: 'Who?', severity: 'warning', retryable: false, errorClass: 'validation' }]),
        ],
        deliverableCount: 0,
      }),
    );
    expect(outcome.state).toBe('FAILED');
  });
});

describe('interpretToolOutput — provider outcomes returned as data are failures', () => {
  it('treats a not_configured provider result as a non-retryable blocking issue', () => {
    const issue = interpretToolOutput({ status: 'not_configured', reason: 'RESEND_API_KEY is missing.' });
    expect(issue).toMatchObject({ errorClass: 'not_configured', retryable: false, message: 'RESEND_API_KEY is missing.' });
  });

  it('treats a rejected provider result as a failure', () => {
    expect(interpretToolOutput({ status: 'failed', reason: 'Rejected by provider', retryable: false })?.errorClass).toBe('server');
    expect(interpretToolOutput({ status: 'failed', reason: 'Rate limited', retryable: true })?.retryable).toBe(true);
  });

  it('does not treat domain statuses or successful sends as failures', () => {
    expect(interpretToolOutput({ status: 'DRAFT' })).toBeNull();
    expect(interpretToolOutput({ status: 'sent', providerMessageId: 'x' })).toBeNull();
    expect(interpretToolOutput({ status: 'skipped', reason: 'Already sent' })).toBeNull();
    expect(interpretToolOutput(null)).toBeNull();
  });
});

describe('verify — strict verification (Phase 17)', () => {
  it('is not ok when any step was skipped, even if others succeeded', () => {
    const verification = verify(
      [step('step-1'), step('step-2')],
      [result('step-1', 'succeeded'), result('step-2', 'skipped')],
      { deliverableCount: 1 },
    );
    expect(verification.ok).toBe(false);
  });

  it('is not ok without a deliverable', () => {
    expect(verify([step('step-1')], [result('step-1', 'succeeded')], { deliverableCount: 0 }).ok).toBe(false);
    expect(verify([step('step-1')], [result('step-1', 'succeeded')], { deliverableCount: 1 }).ok).toBe(true);
  });

  it('is not ok when a successful step produced an empty object', () => {
    const verification = verify([step('step-1')], [result('step-1', 'succeeded', {})], { deliverableCount: 1 });
    expect(verification.ok).toBe(false);
  });
});
