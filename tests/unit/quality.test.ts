import { describe, expect, it } from 'vitest';
import { runQualityCheckTool } from '@/server/tools/operations';
import { runMedicalSafetyCheckTool } from '@/server/tools/research';
import { actor, repo, TEST_ORG } from '../helpers/context';

const ctx = () => ({ actor: actor(), repo: repo(), taskId: 'task', runId: 'run', organizationId: TEST_ORG, idempotencyKey: 'k' });

describe('Quality control rubric (CEO spec §6, §8)', () => {
  it('flags unsourced statistics as a blocking finding', async () => {
    const result = (await runQualityCheckTool.execute(
      { subject: 'Market brief', content: 'The market grew 47% last year and reached 12 million users.', medicalDomain: false },
      ctx() as never,
    )) as { blocking: boolean; findings: Array<{ id: string; severity: string }> };

    expect(result.findings.some((f) => f.id === 'no-fabricated-numbers')).toBe(true);
    expect(result.blocking).toBe(true);
  });

  it('accepts a statistic that carries a source', async () => {
    const result = (await runQualityCheckTool.execute(
      {
        subject: 'Market brief',
        content: 'The market grew 47% last year (source: https://example.com/report-2025).',
        medicalDomain: false,
      },
      ctx() as never,
    )) as { findings: Array<{ id: string }> };

    expect(result.findings.some((f) => f.id === 'no-fabricated-numbers')).toBe(false);
  });

  it('blocks diagnostic and prescriptive language', async () => {
    const result = (await runQualityCheckTool.execute(
      { subject: 'Patient reply', content: 'You have periodontitis. Take this medication twice daily.', medicalDomain: true },
      ctx() as never,
    )) as { blocking: boolean; findings: Array<{ id: string }> };

    expect(result.findings.some((f) => f.id === 'medical-safety')).toBe(true);
    expect(result.blocking).toBe(true);
  });

  it('blocks output that claims an external action already happened', async () => {
    const result = (await runQualityCheckTool.execute(
      { subject: 'Email draft', content: 'Your email has been sent to the client.', medicalDomain: false },
      ctx() as never,
    )) as { findings: Array<{ id: string }> };

    expect(result.findings.some((f) => f.id === 'action-honesty')).toBe(true);
  });

  it('warns when uncertainty is not surfaced', async () => {
    const long = 'This is a substantive deliverable. '.repeat(40);
    const result = (await runQualityCheckTool.execute(
      { subject: 'Brief', content: long, medicalDomain: false },
      ctx() as never,
    )) as { findings: Array<{ id: string }> };

    expect(result.findings.some((f) => f.id === 'uncertainty-surfaced')).toBe(true);
  });

  it('requires professional review for medical domain output', async () => {
    const result = (await runQualityCheckTool.execute(
      { subject: 'Dental brief', content: 'General information about oral hygiene routines.', medicalDomain: true },
      ctx() as never,
    )) as { findings: Array<{ id: string }> };

    expect(result.findings.some((f) => f.id === 'medical-review-required')).toBe(true);
  });
});

describe('Dental / medical safety (CEO spec §8)', () => {
  it('blocks diagnosis language', async () => {
    const result = (await runMedicalSafetyCheckTool.execute(
      { text: 'Based on what you describe you have an infection.' },
      ctx() as never,
    )) as { safe: boolean; violations: unknown[]; disclaimer: string };

    expect(result.safe).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.disclaimer).toMatch(/not a diagnosis/i);
  });

  it('allows general educational content', async () => {
    const result = (await runMedicalSafetyCheckTool.execute(
      { text: 'Brushing twice daily is commonly recommended as part of oral hygiene.' },
      ctx() as never,
    )) as { safe: boolean };

    expect(result.safe).toBe(true);
  });
});
