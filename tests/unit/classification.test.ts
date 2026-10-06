import { describe, expect, it } from 'vitest';
import { classify, understand } from '@/server/manager/understand';

describe('Manager — understand stage', () => {
  it('extracts platforms, emails and quoted topics', () => {
    const result = understand('Create an Instagram post about "implant aftercare" for dr@example.com');

    expect(result.entities.platforms).toContain('instagram');
    expect(result.entities.emails).toEqual(['dr@example.com']);
    expect(result.entities.quoted).toEqual(['implant aftercare']);
  });

  it('records missing information rather than guessing it', () => {
    const result = understand('Research the market for dental scheduling software');

    expect(result.missingInformation).toContain('No sources were provided with the request.');
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it('flags posts without a platform as missing information', () => {
    const result = understand('Post an update about the new service');
    expect(result.missingInformation.join(' ')).toMatch(/platform/i);
  });
});

describe('Manager — classify stage', () => {
  it('routes dental subject matter through the dental work type', () => {
    const intent = classify('Research dental implant aftercare protocols');
    expect(intent.primary).toBe('dental_research');
    expect(intent.medicalDomain).toBe(true);
  });

  it('identifies lead generation work', () => {
    const intent = classify('Build a lead list of dental clinics in Manchester');
    expect(intent.primary).toBe('lead_generation');
    expect(intent.requiresEvidence).toBe(true);
  });

  it('identifies email workflow requests', () => {
    const intent = classify('Create a follow-up email sequence for new enquiries');
    expect(intent.primary).toBe('email_workflow');
  });

  it('identifies product development requests', () => {
    const intent = classify('Build a product: a treatment-planning template pack for clinics');
    expect(intent.primary).toBe('product_development');
  });

  it('falls back to general orchestration with low confidence', () => {
    const intent = classify('xyzzy plugh');
    expect(intent.primary).toBe('general_orchestration');
    expect(intent.confidence).toBeLessThan(0.5);
  });

  it('always reports the signals used so classification is auditable', () => {
    const intent = classify('Prepare a LinkedIn post');
    expect(intent.signals.length).toBeGreaterThan(0);
  });
});
