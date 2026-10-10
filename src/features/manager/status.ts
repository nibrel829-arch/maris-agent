/**
 * One mapping from persisted Manager states to what the user sees (Phase 17).
 * Used by the cockpit list and the assignment workspace so labels never drift.
 */
import { TASK_STATE_LABEL, type ManagerTaskRecordState } from '@/types/manager';

export type TaskTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export const TASK_TONE: Record<ManagerTaskRecordState, TaskTone> = {
  RECEIVED: 'neutral',
  PLANNING: 'info',
  EXECUTING: 'info',
  VERIFYING: 'info',
  WAITING_APPROVAL: 'warning',
  NEEDS_INPUT: 'warning',
  BLOCKED: 'danger',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

export function taskStateLabel(state: string): string {
  return (TASK_STATE_LABEL as Record<string, string>)[state] ?? state.replace(/_/g, ' ');
}

export function taskStateTone(state: string): TaskTone {
  return (TASK_TONE as Record<string, TaskTone>)[state] ?? 'neutral';
}

/** States that wait for a person and therefore show a call to action. */
export function needsPerson(state: string): boolean {
  return state === 'NEEDS_INPUT' || state === 'WAITING_APPROVAL' || state === 'BLOCKED' || state === 'FAILED';
}
