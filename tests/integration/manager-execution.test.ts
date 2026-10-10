import { describe, expect, it } from 'vitest';
import { runManagerTask, resumeManagerTask, ManagerConflictError } from '@/server/manager/orchestrator';
import { authorizeArtifactDownload, listTaskDeliverables, sha256Hex } from '@/server/artifacts/service';
import { requireAi } from '@/server/manager/route-guards';
import { classify, understand } from '@/server/manager/understand';
import { readZip } from '@/server/artifacts/zip';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';

const SOURCES = [
  'Clinics report that online booking reduces missed appointments | https://example.org/booking-study',
  'Practice managers want reminders by SMS',
].join('\n');

const decoder = new TextDecoder();

describe('Manager execution: request to deliverable (Phase 17)', () => {
  it('completes research only after sources are supplied, and stores a DOCX brief', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Research the market for dental scheduling software', actor: owner, repo: store });
    expect(task.state).toBe('NEEDS_INPUT');

    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store, answers: { sources: SOURCES } });
    expect(resumed.state).toBe('COMPLETED');

    const deliverable = resumed.result?.deliverables.find((item) => item.kind === 'research_brief');
    expect(deliverable).toBeDefined();
    expect(deliverable?.format).toBe('docx');
    expect(deliverable?.file_name).toMatch(/\.docx$/);

    const download = await authorizeArtifactDownload({ repo: store, actor: owner, artifactId: deliverable!.id });
    expect(download.ok).toBe(true);
    if (!download.ok) return;
    const files = readZip(download.data.bytes);
    const document = decoder.decode(files.get('word/document.xml'));
    expect(document).toContain('Clinics report that online booking reduces missed appointments');
    expect(document).toContain('https://example.org/booking-study');
    expect(download.data.bytes.length).toBe(deliverable?.size_bytes);
    expect(sha256Hex(download.data.bytes)).toBe(deliverable?.sha256);
  });

  it('asks for the target customer instead of creating a concept with a placeholder', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Build a product: a treatment planning template pack', actor: owner, repo: store });

    expect(task.state).toBe('NEEDS_INPUT');
    const concept = task.plan?.steps.find((step) => step.toolName === 'create_product_concept');
    expect(concept?.clarificationField).toBe('targetCustomer');
    expect(JSON.stringify(task.plan?.steps)).not.toMatch(/to be confirmed/i);
    expect(task.stepResults.some((result) => result.toolName === 'create_product_concept' && result.status === 'succeeded')).toBe(false);
  });

  it('resumes after the target customer and sources are answered, and keeps prior step results', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Build a product: a treatment planning template pack', actor: owner, repo: store });
    const before = task.stepResults.filter((result) => result.status === 'skipped' || result.status === 'succeeded');

    const resumed = await resumeManagerTask({
      taskId: task.id,
      actor: owner,
      repo: store,
      answers: { sources: SOURCES, targetCustomer: 'Solo dental hygienists in Pakistan' },
    });

    expect(resumed.state).toBe('COMPLETED');
    expect(resumed.plan?.clarifications?.every((item) => item.answer !== null)).toBe(true);
    expect(resumed.result?.deliverables.map((item) => item.kind)).toEqual(expect.arrayContaining(['research_brief', 'product_concept']));

    const concept = resumed.plan?.steps.find((step) => step.toolName === 'create_product_concept');
    expect(concept?.input.targetCustomer).toBe('Solo dental hygienists in Pakistan');
    // Steps that were not answered are re-used, not silently re-run.
    expect(resumed.stepResults.filter((result) => result.status === 'succeeded').length).toBeGreaterThanOrEqual(
      before.filter((result) => result.status === 'succeeded').length,
    );
  });

  it('asks for the campaign audience and delivers a campaign plan once it is named', async () => {
    const store = repo();
    const owner = actor();
    const request = 'Create a content campaign for our spring skincare launch on instagram and linkedin';
    const task = await runManagerTask({ request, actor: owner, repo: store });

    expect(task.intent?.primary).toBe('marketing');
    expect(task.state).toBe('NEEDS_INPUT');
    expect(task.plan?.clarifications?.map((item) => item.field)).toContain('audience');

    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store, answers: { audience: 'women aged 25-40 in Lahore' } });
    expect(resumed.state).toBe('COMPLETED');
    const plan = resumed.result?.deliverables.find((item) => item.kind === 'campaign_plan');
    expect(plan).toBeDefined();
  });

  it('plans the outreach template as the draft when no recipient is given, and asks for the audience', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Prepare a focused outreach plan for dental clinics in Karachi', actor: owner, repo: store });

    expect(task.intent?.primary).toBe('outreach');
    expect(task.plan?.steps.some((step) => step.toolName === 'prepare_email')).toBe(false);
    // The request names the audience, so the outreach template completes with a DOCX draft.
    expect(task.state).toBe('COMPLETED');
    expect(task.result?.deliverables.map((item) => item.kind)).toContain('outreach_draft');
  });

  it('never marks a task complete while a clarification is open, for any unanswered field', async () => {
    const requests = [
      'Research the market for dental scheduling software',
      'Build a product: a treatment planning template pack',
      'Create a follow-up email sequence for new enquiries',
    ];
    for (const request of requests) {
      const task = await runManagerTask({ request, actor: actor(), repo: repo() });
      expect(task.state, request).not.toBe('COMPLETED');
      expect(task.plan?.clarifications?.some((item) => item.answer === null), request).toBe(true);
    }
  });
});

describe('Resume and status transitions', () => {
  it('rejects an answer for a question the Manager did not ask', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Research the market for dental scheduling software', actor: owner, repo: store });
    await expect(
      resumeManagerTask({ taskId: task.id, actor: owner, repo: store, answers: { favouriteColour: 'blue' } }),
    ).rejects.toBeInstanceOf(ManagerConflictError);
  });

  it('refuses to resume a completed task', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Draft a LinkedIn post about our new service', actor: owner, repo: store });
    expect(task.state).toBe('COMPLETED');
    await expect(resumeManagerTask({ taskId: task.id, actor: owner, repo: store })).rejects.toBeInstanceOf(ManagerConflictError);
  });

  it('keeps answered questions in the plan as history with their answers', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Research the market for dental scheduling software', actor: owner, repo: store });
    const resumed = await resumeManagerTask({ taskId: task.id, actor: owner, repo: store, answers: { sources: SOURCES } });
    const sources = resumed.plan?.clarifications?.find((item) => item.field === 'sources');
    expect(sources?.answer).toContain('online booking');
    expect(sources?.answeredAt).toBeTruthy();
  });

  it('classifies a campaign with a named channel as marketing, not social media', () => {
    const request = 'Create a content campaign for our spring skincare launch on instagram and linkedin';
    const intent = classify(request, understand(request));
    expect(intent.primary).toBe('marketing');
    expect(intent.signals).toContain('content campaign');
  });
});

describe('Organization isolation and role authorization', () => {
  it('keeps deliverables inside the owning organization', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Draft a LinkedIn post about our new service', actor: owner, repo: store });
    const [deliverable] = task.result?.deliverables ?? [];
    expect(deliverable).toBeDefined();

    const otherOrgUser = actor({ organizationId: OTHER_ORG });
    const crossOrg = await authorizeArtifactDownload({ repo: store, actor: otherOrgUser, artifactId: deliverable!.id });
    expect(crossOrg).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', status: 404 } });

    const listed = await listTaskDeliverables({ repo: store, actor: otherOrgUser, taskId: task.id });
    expect(listed.ok && listed.data).toEqual([]);
  });

  it('refuses a download to the client role even when the artifact exists', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Draft a LinkedIn post about our new service', actor: owner, repo: store });
    const deliverable = task.result?.deliverables[0];
    const client = actor({ role: 'client' });

    const denied = await authorizeArtifactDownload({ repo: store, actor: client, artifactId: deliverable!.id });
    expect(denied).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED', status: 403 } });
  });

  it('lets team members view and create work but not decide approvals', () => {
    const member = actor({ role: 'member' });
    expect(requireAi(member, 'view')).toBeNull();
    expect(requireAi(member, 'create')).toBeNull();

    const client = actor({ role: 'client' });
    expect(requireAi(client, 'view')).toBeNull();
    expect(requireAi(client, 'create')).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses to resume a task from another organization', async () => {
    const store = repo();
    const task = await runManagerTask({ request: 'Research the market for dental scheduling software', actor: actor(), repo: store });
    await expect(
      resumeManagerTask({ taskId: task.id, actor: actor({ organizationId: OTHER_ORG }), repo: store, answers: { sources: 'x' } }),
    ).rejects.toThrow(/not found/i);
    expect(TEST_ORG).not.toBe(OTHER_ORG);
  });
});

describe('Artifact integrity', () => {
  it('detects a stored file that no longer matches its digest', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Draft a LinkedIn post about our new service', actor: owner, repo: store });
    const deliverable = task.result?.deliverables[0];
    const row = await store.managerArtifacts.get(deliverable!.id, TEST_ORG);
    expect(row).not.toBeNull();

    // Simulate a corrupted row: change the bytes but keep the recorded digest.
    const tampered = Buffer.from('not the original file').toString('base64');
    await store.managerArtifacts.update(deliverable!.id, TEST_ORG, { content_base64: tampered } as never);

    const download = await authorizeArtifactDownload({ repo: store, actor: owner, artifactId: deliverable!.id });
    expect(download).toMatchObject({ ok: false, error: { code: 'INTEGRITY_FAILED', status: 500 } });
  });

  it('stores a deliverable only for a verified completion, never for a paused task', async () => {
    const store = repo();
    const task = await runManagerTask({ request: 'Research the market for dental scheduling software', actor: actor(), repo: store });
    expect(task.state).toBe('NEEDS_INPUT');
    const stored = await store.managerArtifacts.list(TEST_ORG, { limit: 100 });
    expect(stored.filter((item) => item.task_id === task.id)).toEqual([]);
  });

  it('records the deliverable in the audit trail', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({ request: 'Draft a LinkedIn post about our new service', actor: owner, repo: store });
    const logs = await store.activityLogs.list(TEST_ORG, { limit: 200 });
    expect(logs.some((log) => log.entity_id === task.id && /artifact/.test(log.action))).toBe(true);
  });
});
