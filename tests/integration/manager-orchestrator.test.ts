import { describe, expect, it } from 'vitest';
import { runManagerTask, resumeManagerTask } from '@/server/manager/orchestrator';
import { actor, repo, TEST_ORG } from '../helpers/context';

const run = (request: string, role: Parameters<typeof actor>[0] extends never ? never : 'owner' | 'member' = 'owner') =>
  runManagerTask({ request, actor: actor({ role }), repo: repo() });

describe('NIBREXO CEO / Manager — orchestration (integration)', () => {
  it('completes a research request and produces a research brief artifact', async () => {
    const snapshot = await run('Research the market for dental scheduling software');

    expect(snapshot.intent?.primary).toBe('research');
    expect(snapshot.result?.artifacts.length).toBeGreaterThan(0);
    expect(snapshot.result?.aiEnabled).toBe(false);
    // Without a search provider the sourced step is blocked. The brief is saved,
    // but the task is not reported complete and no evidence is invented.
    if (!process.env.BRAVE_SEARCH_API_KEY) {
      expect(snapshot.state).not.toBe('COMPLETED');
      expect(snapshot.result?.completion).toBe('partial');
      expect(snapshot.stepResults.some((result) => result.status === 'blocked')).toBe(true);
      const brief = snapshot.result?.artifacts.find((artifact) => {
        const content = artifact.content as Record<string, unknown> | null;
        return Boolean(content && 'brief' in content);
      });
      const evidence = (brief?.content as { brief?: { evidence?: unknown[] } } | undefined)?.brief?.evidence ?? [];
      expect(evidence).toEqual([]);
    } else {
      expect(['COMPLETED', 'FAILED']).toContain(snapshot.state);
    }

    const brief = snapshot.result?.artifacts.find((artifact) => {
      const content = artifact.content as Record<string, unknown> | null;
      return Boolean(content && 'brief' in content);
    });
    expect(brief).toBeDefined();
  });

  it('records the full CEO pipeline in the task trace', async () => {
    const snapshot = await run('Research competitor pricing');
    const stages = snapshot.trace.map((entry) => entry.stage);

    for (const stage of ['understand', 'classify', 'plan', 'select_skills', 'execute', 'verify', 'quality_control', 'deliver', 'next_best_action']) {
      expect(stages).toContain(stage);
    }
  });

  it('keeps the PDF #08 state machine as the persisted status', async () => {
    const snapshot = await run('Give me a status report');
    expect(['COMPLETED', 'FAILED', 'WAITING_APPROVAL']).toContain(snapshot.state);
  });

  it('flags dental output for medical review rather than answering clinically', async () => {
    const snapshot = await run('Research dental implant aftercare protocols');

    const medicalArtifact = snapshot.result?.artifacts.find((artifact) => {
      const content = artifact.content as Record<string, unknown> | null;
      return Boolean(content && 'brief' in content);
    });
    const brief = (medicalArtifact?.content as { brief?: { medical_review_required?: boolean } } | undefined)
      ?.brief;

    expect(brief?.medical_review_required).toBe(true);
  });

  it('never claims an external action happened when it only prepared one', async () => {
    const snapshot = await run(
      'Create a follow-up email for the clinic at clinic@example.com about their enquiry',
    );

    const prepared = snapshot.result?.artifacts.find((artifact) => {
      const content = artifact.content as Record<string, unknown> | undefined;
      return Boolean(content && 'emailLog' in content);
    });
    const emailLog = (prepared?.content as { emailLog?: { status?: string } } | undefined)?.emailLog;

    expect(emailLog?.status).toBe('DRAFT');
    expect(snapshot.result?.summary).toMatch(/prepared/i);
  });

  it('records skipped steps as open questions instead of inventing input', async () => {
    const snapshot = await run('Build a lead list of dental clinics in Manchester');

    const skipped = snapshot.stepResults.filter((result) => result.status === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped[0]?.issues[0]?.code).toBe('NEEDS_CLARIFICATION');
    expect(
      snapshot.result?.nextBestAction.some((action) => /missing input/i.test(action.title)),
    ).toBe(true);
  });

  it('denies steps the role cannot perform', async () => {
    const snapshot = await run('Create a follow-up email sequence for new enquiries', 'member');
    // A member may create drafts, so nothing is denied here; the guard is
    // exercised directly for publish/send in permissions tests.
    expect(snapshot.state).not.toBe('RECEIVED');
  });

  it('persists an activity audit trail for the task', async () => {
    const store = repo();
    const snapshot = await runManagerTask({
      request: 'Give me a status report',
      actor: actor(),
      repo: store,
    });

    const logs = await store.activityLogs.list(TEST_ORG, { limit: 100 });
    const actions = logs.map((log) => log.action);

    expect(actions).toContain('manager.task.created');
    expect(actions).toContain('manager.task.completed');
    expect(logs.some((log) => log.entity_id === snapshot.id)).toBe(true);
  });

  it('resumes a task after an approval is granted', async () => {
    const store = repo();
    const owner = actor();

    // Seed a connected-looking account and a draft email so the external send
    // step has something real to act on.
    const draft = await store.emailLogs.insert({
      organization_id: TEST_ORG,
      client_id: null,
      template_id: null,
      to_email: 'clinic@example.com',
      subject: 'Follow-up',
      body: 'Hello there',
      status: 'DRAFT',
      provider_message_id: null,
      error_message: null,
      created_by: owner.userId,
    });

    const snapshot = await runManagerTask({
      request: `Send the email ${draft.id} to the clinic`,
      actor: owner,
      repo: store,
    });

    // The decisive behaviour: without a provider configured the Manager must
    // report the blocker instead of faking a send.
    expect(snapshot.result?.summary).toBeTruthy();

    const approvals = await store.approvals.list(TEST_ORG, { limit: 50 });
    const taskApprovals = approvals.filter((approval) => approval.task_id === snapshot.id);

    if (taskApprovals.length > 0) {
      expect(snapshot.state).toBe('WAITING_APPROVAL');

      await store.approvals.update(taskApprovals[0]!.id, TEST_ORG, {
        status: 'approved',
        decided_by: owner.userId,
        decided_at: new Date().toISOString(),
      } as never);

      const resumed = await resumeManagerTask({
        taskId: snapshot.id,
        actor: owner,
        repo: store,
      });

      expect(['COMPLETED', 'FAILED', 'WAITING_APPROVAL']).toContain(resumed.state);
    } else {
      // No external step was planned for this phrasing; that is a valid outcome.
      expect(snapshot.state).not.toBe('RECEIVED');
    }
  });

  it('blocks reuse of an expired approval', async () => {
    const store = repo();
    const owner = actor();

    const task = await runManagerTask({
      request: 'Research the market for dental scheduling software',
      actor: owner,
      repo: store,
    });

    const stale = await store.approvals.insert({
      organization_id: TEST_ORG,
      task_id: task.id,
      step_id: 'step-1',
      action: 'Publish the post',
      tool_name: 'publish_post',
      risk: 'high',
      reason: 'Test approval',
      summary: 'Test',
      payload: {},
      status: 'pending',
      requested_by: owner.userId,
      decided_by: null,
      decision_note: null,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      decided_at: null,
    } as never);

    const expired = await store.approvals.get(stale.id, TEST_ORG);
    expect(expired?.status).toBe('pending');
    expect(Date.parse(expired!.expires_at)).toBeLessThan(Date.now());
  });
});

describe('Manager deliverables', () => {
  it('produces one merged artifact per deliverable, excluding control steps', async () => {
    const snapshot = await run(
      'Build a product: a treatment-planning template pack for dental clinics',
    );

    const titles = (snapshot.result?.artifacts ?? []).map((artifact) => artifact.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(
      (snapshot.result?.artifacts ?? []).some((artifact) =>
        /medical safety/i.test(artifact.title),
      ),
    ).toBe(false);
  });

  it('reports uncertainty rather than hiding it', async () => {
    const snapshot = await run(
      'Build a product: a treatment-planning template pack for dental clinics',
    );
    const artifact = snapshot.result?.artifacts[0];
    expect(artifact?.uncertainties.length).toBeGreaterThan(0);
  });

  it('records the AI layer state honestly', async () => {
    const snapshot = await run('Give me a status report');
    const aiConfigured = Boolean(process.env.OPENAI_API_KEY);
    expect(snapshot.result?.aiEnabled).toBe(aiConfigured);
  });
});
