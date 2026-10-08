import { describe, expect, it } from 'vitest';
import { continueManagerTask, retryManagerTask, runManagerTask } from '@/server/manager/orchestrator';
import { executeSteps } from '@/server/manager/execution-engine';
import { actor, repo, OTHER_ORG, TEST_ORG } from '../helpers/context';

const EXAMPLE =
  'Research my new product, prepare an image concept, create a video draft and save all completed assets to my Content Library.';

describe('Manager real execution loop', () => {
  it('saves completed assets, blocks missing providers, and does not mark the task complete', async () => {
    const store = repo();
    const snapshot = await runManagerTask({
      request: EXAMPLE,
      actor: actor(),
      repo: store,
    });

    expect(snapshot.state).not.toBe('COMPLETED');
    expect(snapshot.result?.completion).toBe('partial');
    expect(snapshot.result?.summary).toMatch(/not complete/i);
    expect(snapshot.result?.summary).not.toMatch(/task is complete/i);

    const statuses = new Map(snapshot.stepResults.map((result) => [result.toolName, result.status]));
    expect(statuses.get('conduct_sourced_research')).toBe('blocked');
    expect(statuses.get('generate_image_asset')).toBe('blocked');
    expect(statuses.get('prepare_video_draft')).toBe('succeeded');
    expect(statuses.get('export_video_file')).toBe('blocked');
    expect(statuses.get('create_visual_concept')).toBe('succeeded');

    const content = await store.contentItems.list(TEST_ORG, { limit: 20 });
    expect(content.some((item) => /video draft/i.test(item.title))).toBe(true);
    expect(content.some((item) => /image concept/i.test(item.title))).toBe(true);
    expect(content.every((item) => item.status === 'DRAFT')).toBe(true);
    expect(snapshot.result?.references.some((reference) => reference.href?.startsWith('/content/'))).toBe(true);

    const briefs = await store.researchBriefs.list(TEST_ORG, { limit: 10 });
    expect(briefs[0]?.evidence ?? []).toEqual([]);
    expect(briefs[0]?.gaps.join(' ')).toMatch(/BRAVE_SEARCH_API_KEY|No sources/i);

    const other = await store.contentItems.list(OTHER_ORG, { limit: 20 });
    expect(other).toEqual([]);
    expect(await store.tasks.get(snapshot.id, OTHER_ORG)).toBeNull();
  });

  it('retries blocked steps without duplicating a saved video draft', async () => {
    const store = repo();
    const owner = actor();
    const first = await runManagerTask({ request: EXAMPLE, actor: owner, repo: store });
    const before = await store.contentItems.list(TEST_ORG, { limit: 20 });
    const draftCount = before.filter((item) => /video draft/i.test(item.title)).length;

    const retried = await retryManagerTask({ taskId: first.id, actor: owner, repo: store });
    const after = await store.contentItems.list(TEST_ORG, { limit: 20 });
    expect(after.filter((item) => /video draft/i.test(item.title))).toHaveLength(draftCount);
    expect(retried.stepResults.find((result) => result.toolName === 'prepare_video_draft')?.status).toBe('succeeded');
    expect(retried.stepResults.find((result) => result.toolName === 'conduct_sourced_research')?.status).toBe('blocked');
    expect(retried.result?.completion).not.toBe('complete');
  });

  it('does not relabel a finished partial task as cancelled', async () => {
    const store = repo();
    const owner = actor();
    const finished = await runManagerTask({ request: EXAMPLE, actor: owner, repo: store });
    expect(finished.state).toBe('FAILED');
    expect(finished.result?.completion).toBe('partial');

    const kept = await store.tasks.update(finished.id, TEST_ORG, {
      state: 'CANCELLED',
      error: 'Should not overwrite a finished result.',
    });
    expect(kept?.state).toBe('FAILED');
    expect(kept?.result?.completion).toBe('partial');
  });

  it('stops between steps when the task is cancelled', async () => {
    const store = repo();
    const owner = actor();
    const started = await runManagerTask({
      request: 'Give me a status report',
      actor: owner,
      repo: store,
      deferExecution: true,
    });
    await store.tasks.update(started.id, TEST_ORG, { state: 'CANCELLED' });
    const continued = await continueManagerTask({ taskId: started.id, actor: owner, repo: store });
    expect(continued.state).toBe('CANCELLED');
    expect(continued.stepResults.every((result) => result.status !== 'succeeded')).toBe(true);
  });

  it('does not execute a second overlapping run of the same task', async () => {
    const store = repo();
    const owner = actor();
    const started = await runManagerTask({
      request: 'Give me a status report',
      actor: owner,
      repo: store,
      deferExecution: true,
    });

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = continueManagerTask({ taskId: started.id, actor: owner, repo: store }).finally(() => release?.());
    const second = continueManagerTask({ taskId: started.id, actor: owner, repo: store });
    const [a, b] = await Promise.all([first, second]);
    await gate;
    expect([a.state, b.state].every((state) => state === 'COMPLETED' || state === 'EXECUTING' || state === 'PLANNING')).toBe(
      true,
    );
    const reports = await store.qualityReports.list(TEST_ORG, { limit: 10 });
    expect(reports.length).toBeLessThanOrEqual(1);
  });

  it('keeps external send behind approval and does not mark it sent', async () => {
    const store = repo();
    const snapshot = await runManagerTask({
      request: 'Send this email to clinic@example.com about the new product',
      actor: actor(),
      repo: store,
    });
    const send = snapshot.stepResults.find((result) => result.toolName === 'send_email');
    if (send) {
      expect(send.status).not.toBe('succeeded');
      expect(snapshot.state).toBe('WAITING_APPROVAL');
    }
    const logs = await store.emailLogs.list(TEST_ORG, { limit: 10 });
    expect(logs.every((log) => log.status !== 'SENT')).toBe(true);
  });

  it('records a blocked capability as blocked inside the engine', async () => {
    const outcome = await executeSteps(
      [
        {
          id: 'step-1',
          title: 'Blocked tool',
          rationale: 'test',
          skillId: 'research-intelligence',
          toolName: 'conduct_sourced_research',
          input: { topic: 'Pricing', question: 'What is the price?', saveToLibrary: false },
          requiresApproval: false,
          risk: 'low',
          stage: 'execute',
          dependsOn: [],
          clarification: null,
        },
      ],
      {
        actor: actor(),
        repo: repo(),
        taskId: '00000000-0000-0000-0000-0000000000aa',
        runId: 'run',
        organizationId: TEST_ORG,
      },
    );
    expect(outcome.stepResults[0]?.status).toBe('blocked');
    expect(outcome.stepResults[0]?.issues[0]?.errorClass).toBe('not_configured');
    expect(outcome.cancelled).toBe(false);
  });
});
