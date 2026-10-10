import { describe, expect, it } from 'vitest';
import { runManagerTask } from '@/server/manager/orchestrator';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';

/**
 * Repository-level tenant contract. Live Supabase RLS still needs the attached
 * project credentials and the migrations applied; this suite ensures the
 * abstraction does not omit the organization filter in local/test operation.
 */
describe('Repository tenant boundary and Manager persistence', () => {
  it('keeps Manager task, artifact and audit records inside the actor organization', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({
      request: 'Draft a LinkedIn post about our new service',
      actor: owner,
      repo: store,
    });

    const sameTenant = await store.tasks.get(task.id, TEST_ORG);
    const otherTenant = await store.tasks.get(task.id, OTHER_ORG);
    const logsForOwner = await store.activityLogs.list(TEST_ORG, { limit: 100 });
    const logsForOtherOrg = await store.activityLogs.list(OTHER_ORG, { limit: 100 });
    const artifactsForOwner = await store.managerArtifacts.list(TEST_ORG, { limit: 100 });
    const artifactsForOtherOrg = await store.managerArtifacts.list(OTHER_ORG, { limit: 100 });

    expect(sameTenant?.state).toBe('COMPLETED');
    expect(artifactsForOwner.some((artifact) => artifact.task_id === task.id)).toBe(true);
    expect(artifactsForOtherOrg).toEqual([]);
    expect(otherTenant).toBeNull();
    expect(logsForOwner.some((log) => log.entity_id === task.id)).toBe(true);
    expect(logsForOtherOrg).toEqual([]);
  });

  it('does not allow an approval written in one organization to be read or updated from another', async () => {
    const store = repo();
    const owner = actor();
    const approval = await store.approvals.insert({
      organization_id: TEST_ORG,
      task_id: null,
      step_id: null,
      action: 'Send an external email',
      tool_name: 'send_email',
      risk: 'high',
      reason: 'External delivery must be approved.',
      summary: 'Send a prepared email to a customer.',
      payload: {},
      status: 'pending',
      requested_by: owner.userId,
      decided_by: null,
      decision_note: null,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      decided_at: null,
    } as never);

    expect(await store.approvals.get(approval.id, OTHER_ORG)).toBeNull();
    expect(await store.approvals.update(approval.id, OTHER_ORG, { status: 'approved' } as never)).toBeNull();
    expect((await store.approvals.get(approval.id, TEST_ORG))?.status).toBe('pending');
  });
});
