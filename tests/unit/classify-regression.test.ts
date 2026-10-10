import { describe, expect, it } from 'vitest';
import { classify } from '@/server/manager/understand';

/**
 * Regression: "market research … and write a report" used to classify as
 * `content` because "write" and "research" and "report" each scored equally and
 * the first rule won. That produced a content draft marked COMPLETED.
 */
describe('classify — multi-word intent phrases beat generic verbs', () => {
  it('routes "market research … write a report" to research, not content', () => {
    const intent = classify(
      'Do market research on the dental clinic software market in Lahore, Pakistan and write a report',
    );
    expect(intent.primary).toBe('research');
    expect(intent.deliverable).toBe('research_brief');
    expect(intent.requiresEvidence).toBe(true);
  });

  it('routes "write a market research report" to research', () => {
    expect(classify('Write a market research report on dental clinics in Lahore').primary).toBe(
      'research',
    );
  });

  it('keeps clinical research as dental_research when no business qualifier is present', () => {
    expect(classify('Research dental implant aftercare').primary).toBe('dental_research');
  });

  it('keeps a plain blog request as content', () => {
    const intent = classify('Write a blog post about flossing');
    expect(intent.primary).toBe('content');
    expect(intent.deliverable).toBe('content_draft');
  });

  it('keeps a marketing campaign plan as marketing', () => {
    expect(classify('Create a marketing campaign plan for our dental software launch').primary).toBe(
      'marketing',
    );
  });
});
