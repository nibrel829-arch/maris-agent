import { describe, expect, it } from 'vitest';
import { runManagerTask, resumeManagerTask } from '@/server/manager/orchestrator';
import { actor, repo, TEST_ORG } from '../helpers/context';

const EMAIL_SEND_REQUEST =
  'Prepare and send a follow-up email to clinic@example.com about their enquiry';

async function pendingApprovalFor(store: ReturnType<typeof repo>, taskId: string) {
  const approvals = await store.approvals.list(TEST_ORG, { limit: 100 });
  return approvals.find(
    (approval) => approval.task_id === taskId && approval.status === 'pending',
  );
}

describe('Approval lifecycle (PDF #08 §8, CEO spec §9)', () => {
  it('stops an external send until approval is granted', async () => {
    const store = repo();
    const task = await runManagerTask({
      request: EMAIL_SEND_REQUEST,
      actor: actor(),
      repo: store,
    });

    expect(task.state).toBe('WAITING_APPROVAL');

    const approval = await pendingApprovalFor(store, task.id);
    expect(approval).toBeDefined();
    expect(approval?.tool_name).toBe('send_email');
    expect(approval?.risk).toBe('high');

    const sendStep = task.stepResults.find((result) => result.toolName === 'send_email');
    expect(sendStep?.status).toBe('awaiting_approval');
    expect(sendStep?.output).toBeNull();
    expect(task.result?.summary).toMatch(/No external action has been taken/);
  });

  it('executes the approved action exactly once after approval', async () => {
    const store = repo();
    const owner = actor();

    const task = await runManagerTask({ request: EMAIL_SEND_REQUEST, actor: owner, repo: store });
    const approval = await pendingApprovalFor(store, task.id);

    await store.approvals.update(approval!.id, TEST_ORG, {
      status: 'approved',
      decided_by: owner.userId,
      decided_at: new Date().toISOString(),
    } as never);

    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store });

    const sendResults = resumed.stepResults.filter((result) => result.toolName === 'send_email');
    expect(sendResults).toHaveLength(1);
    // No provider is configured in tests. The approved send is executed exactly
    // once and reports the unconfigured provider as a failure, never as sent.
    expect(sendResults[0]?.status).toBe('failed');
    expect(sendResults[0]?.issues[0]?.errorClass).toBe('not_configured');
    expect(resumed.state).toBe('BLOCKED');
    expect(resumed.result?.summary).not.toMatch(/Verified and delivered/);

    const approvalsAfter = (await store.approvals.list(TEST_ORG, { limit: 100 })).filter(
      (entry) => entry.task_id === task.id,
    );
    expect(approvalsAfter).toHaveLength(1);
  });

  it('does not execute a rejected action', async () => {
    const store = repo();
    const owner = actor();

    const task = await runManagerTask({ request: EMAIL_SEND_REQUEST, actor: owner, repo: store });
    const approval = await pendingApprovalFor(store, task.id);

    await store.approvals.update(approval!.id, TEST_ORG, {
      status: 'rejected',
      decided_by: owner.userId,
      decided_at: new Date().toISOString(),
    } as never);

    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store });
    const send = resumed.stepResults.find((result) => result.toolName === 'send_email');

    expect(send?.status).toBe('denied');
    expect(send?.issues[0]?.code).toBe('APPROVAL_REJECTED');
  });

  it('refuses to reuse an expired approval', async () => {
    const store = repo();
    const owner = actor();

    const task = await runManagerTask({ request: EMAIL_SEND_REQUEST, actor: owner, repo: store });
    const approval = await pendingApprovalFor(store, task.id);

    await store.approvals.update(approval!.id, TEST_ORG, {
      status: 'approved',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      decided_by: owner.userId,
      decided_at: new Date().toISOString(),
    } as never);

    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store });
    const send = resumed.stepResults.find((result) => result.toolName === 'send_email');

    expect(send?.status).toBe('denied');
    expect(send?.issues[0]?.code).toBe('APPROVAL_EXPIRED');
  });

  it('reports an unconfigured provider instead of faking a send', async () => {
    const store = repo();
    const owner = actor();

    const task = await runManagerTask({ request: EMAIL_SEND_REQUEST, actor: owner, repo: store });
    const approval = await pendingApprovalFor(store, task.id);

    await store.approvals.update(approval!.id, TEST_ORG, {
      status: 'approved',
      decided_by: owner.userId,
      decided_at: new Date().toISOString(),
    } as never);

    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store });
    const send = resumed.stepResults.find((result) => result.toolName === 'send_email');
    const output = send?.output as { status?: string; emailLog?: { status?: string } } | null;

    expect(output?.status).toBe('not_configured');
    expect(output?.emailLog?.status).toBe('DRAFT');
  });

  it('keeps a pending task parked while no decision exists', async () => {
    const store = repo();
    const owner = actor();

    const task = await runManagerTask({ request: EMAIL_SEND_REQUEST, actor: owner, repo: store });
    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store });

    expect(resumed.state).toBe('WAITING_APPROVAL');
    const stillWaiting = resumed.stepResults.find((result) => result.toolName === 'send_email');
    expect(stillWaiting?.status).toBe('awaiting_approval');
  });
});
