/**
 * Phase 18 regression (end to end, memory repository, fixture data only).
 *
 * The sources below are clearly labelled test fixtures. They are not real
 * research and must never be described as such.
 */
import { describe, expect, it } from 'vitest';
import { runManagerTask, resumeManagerTask } from '@/server/manager/orchestrator';
import { authorizeArtifactDownload, listTaskDeliverables } from '@/server/artifacts/service';
import { actor, repo } from '../helpers/context';

const decoder = new TextDecoder();

describe('Manager: unsourced research is never completed (Phase 18)', () => {
  it('keeps research in Needs input when every claim is unsourced, and produces no brief', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({
      request: 'Research the dental software market in Karachi and summarise the findings',
      actor: owner,
      repo: store,
    });
    expect(task.state).toBe('NEEDS_INPUT');

    const resumed = await resumeManagerTask({
      taskId: task.id,
      actor: owner,
      repo: store,
      answers: { sources: 'Dental clinics in Karachi want faster booking' },
    });

    expect(resumed.state).toBe('NEEDS_INPUT');
    expect(resumed.result?.deliverables ?? []).toHaveLength(0);
    expect(resumed.stepResults.some((r) => r.toolName === 'create_research_brief' && r.status === 'succeeded')).toBe(false);
    expect(resumed.result?.summary ?? '').not.toMatch(/completed|verified and delivered/i);
  });

  it('re-opens the sources question after an unsourced answer, so the user can answer again', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({
      request: 'Research the dental software market in Karachi and summarise the findings',
      actor: owner,
      repo: store,
    });
    const reopened = await resumeManagerTask({
      taskId: task.id,
      actor: owner,
      repo: store,
      answers: { sources: 'Dental clinics in Karachi want faster booking' },
    });

    expect(reopened.state).toBe('NEEDS_INPUT');
    const open = (reopened.plan?.clarifications ?? []).filter((item) => item.answer === null);
    // Without this the UI shows no form and the task can never finish.
    expect(open.map((item) => item.field)).toEqual(['sources']);

    const finished = await resumeManagerTask({
      taskId: task.id,
      actor: owner,
      repo: store,
      // FIXTURE: test source line, not a real-world citation.
      answers: { sources: 'Fixture claim: clinics report fewer missed bookings | Fixture source (test data)' },
    });
    expect(finished.state).toBe('COMPLETED');
  });

  it('completes once one claim carries a source, and labels the unsourced claim as interpretation', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({
      request: 'Research the dental software market in Karachi and summarise the findings',
      actor: owner,
      repo: store,
    });
    const resumed = await resumeManagerTask({
      taskId: task.id,
      actor: owner,
      repo: store,
      answers: {
        sources: [
          'Dental clinics in Karachi want faster booking',
          // FIXTURE: test source line, not a real-world citation.
          'Fixture claim: clinics report fewer missed bookings | Fixture source (test data)',
        ].join('\n'),
      },
    });

    expect(resumed.state).toBe('COMPLETED');
    const brief = resumed.result?.deliverables.find((item) => item.kind === 'research_brief');
    expect(brief).toBeDefined();

    const download = await authorizeArtifactDownload({ repo: store, actor: owner, artifactId: brief!.id });
    expect(download.ok).toBe(true);
    if (!download.ok) return;
    const text = decoder.decode(download.data.bytes);
    expect(text).toContain('Fixture source (test data)');
    expect(text).toContain('Dental clinics in Karachi want faster booking');
  });
});

describe('Manager: lead CSV carries the lead record, not the research blob (Phase 18)', () => {
  it('writes a single-line source and the lead stage into the CSV', async () => {
    const store = repo();
    const owner = actor();
    const task = await runManagerTask({
      request: 'Create a lead for a dental clinic prospect in Karachi',
      actor: owner,
      repo: store,
    });
    expect(task.state).toBe('NEEDS_INPUT');

    const resumed = await resumeManagerTask({
      taskId: task.id,
      actor: owner,
      repo: store,
      answers: {
        name: 'Sindh Smile Dental Clinic',
        // FIXTURE: test source line, not a real-world citation.
        sources: 'Fixture: clinics have phone-only booking | Fixture source (test data)\nSecond fixture line',
      },
    });
    expect(resumed.state).toBe('COMPLETED');

    const deliverables = await listTaskDeliverables({ repo: store, actor: owner, taskId: task.id });
    expect(deliverables.ok).toBe(true);
    if (!deliverables.ok) return;
    const csvRecord = deliverables.data.find((item) => item.format === 'csv');
    expect(csvRecord).toBeDefined();

    const download = await authorizeArtifactDownload({ repo: store, actor: owner, artifactId: csvRecord!.id });
    expect(download.ok).toBe(true);
    if (!download.ok) return;
    const csv = decoder.decode(download.data.bytes);
    expect(csv.split('\r\n')[0]).toBe('name,company,email,source,stage');
    expect(csv).toContain('Sindh Smile Dental Clinic');
    expect(csv).toContain('Fixture source (test data)');
    // The lead source is one label, never the multi-line answer.
    expect(csv).not.toContain('Second fixture line');
    expect(csv).not.toContain('Fixture: clinics have phone-only booking');
  });
});
