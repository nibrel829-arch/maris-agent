/**
 * Task-state transitions that must stay honest under concurrent cancel.
 *
 * A finished task is not relabelled cancelled. A cancel that landed first is
 * not overwritten by a later completion write.
 */

export const FINISHED_TASK_STATES = ['COMPLETED', 'FAILED', 'WAITING_APPROVAL'] as const;
export const CANCELLABLE_TASK_STATES = ['RECEIVED', 'PLANNING', 'EXECUTING', 'VERIFYING'] as const;

export type TaskStateDecision = 'refuse-cancel' | 'preserve-cancel' | 'apply';

export function taskStateDecision(currentState: string, patchState: string | undefined): TaskStateDecision {
  if (
    patchState === 'CANCELLED' &&
    (FINISHED_TASK_STATES as readonly string[]).includes(currentState)
  ) {
    return 'refuse-cancel';
  }
  if (currentState === 'CANCELLED' && patchState !== undefined && patchState !== 'CANCELLED') {
    return 'preserve-cancel';
  }
  return 'apply';
}
