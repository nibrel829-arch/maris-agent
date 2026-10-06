import { describe, expect, it } from 'vitest';
import { resolveStepReferences, stepRef } from '@/server/manager/input-resolver';
import type { StepResult } from '@/types/manager';

const result = (stepId: string, output: unknown): StepResult => ({
  stepId,
  status: 'succeeded',
  toolName: 'tool',
  output,
  issues: [],
  approval: null,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: 1,
});

describe('Step input references', () => {
  it('resolves a value produced by an earlier step', () => {
    const previous = [result('step-1', { contentItem: { id: 'abc-123' } })];
    const { input, unresolved } = resolveStepReferences(
      { contentId: stepRef('step-1', 'contentItem.id') },
      previous,
    );

    expect(input.contentId).toBe('abc-123');
    expect(unresolved).toEqual([]);
  });

  it('resolves array positions', () => {
    const previous = [result('step-1', [{ id: 'first' }, { id: 'second' }])];
    const { input } = resolveStepReferences({ accountId: stepRef('step-1', '1.id') }, previous);
    expect(input.accountId).toBe('second');
  });

  it('reports an unresolved reference instead of inventing a value', () => {
    const previous = [result('step-1', { contentItem: { id: 'abc' } })];
    const { input, unresolved } = resolveStepReferences(
      { accountId: stepRef('step-1', 'missing.id') },
      previous,
    );

    expect(input.accountId).toBeUndefined();
    expect(unresolved[0]).toMatch(/did not produce it/);
  });

  it('ignores failed step outputs', () => {
    const previous = [
      { ...result('step-1', { id: 'abc' }), status: 'failed' as const },
    ];
    const { unresolved } = resolveStepReferences({ id: stepRef('step-1', 'id') }, previous);
    expect(unresolved.length).toBe(1);
  });

  it('resolves nested references', () => {
    const previous = [result('step-2', { emailLog: { id: 'log-9' } })];
    const { input } = resolveStepReferences(
      { payload: { emailLogId: stepRef('step-2', 'emailLog.id') } },
      previous,
    );
    expect((input.payload as { emailLogId: string }).emailLogId).toBe('log-9');
  });
});
