/**
 * In-process single-flight lock for a Manager task.
 *
 * A second execute/retry of the same task id returns false instead of running
 * the plan again. This is process-local; the email and publish workers use
 * database SKIP LOCKED for their own queues. Manager tasks stay on ai_tasks.
 */

const running = new Set<string>();

export function claimTaskRun(taskId: string): boolean {
  if (running.has(taskId)) return false;
  running.add(taskId);
  return true;
}

export function releaseTaskRun(taskId: string): void {
  running.delete(taskId);
}

export function isTaskRunning(taskId: string): boolean {
  return running.has(taskId);
}
