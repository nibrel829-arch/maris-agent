/**
 * Phase 18 regression: research must have at least one sourced claim before it
 * can complete, and a lead's source is a single clean label.
 */
import { describe, expect, it } from 'vitest';
import { buildPlan, leadSourceLabel } from '@/server/manager/planner';
import { classify, understand } from '@/server/manager/understand';

const RESEARCH = 'Research the dental software market in Karachi and summarise the findings';
const LEAD = 'Create a lead for a dental clinic prospect in Karachi';

function planFor(request: string, answers: Record<string, string>) {
  const understood = understand(request);
  return buildPlan(classify(request, understood), understood, answers);
}

function briefStep(plan: ReturnType<typeof planFor>) {
  return plan.steps.find((step) => step.toolName === 'create_research_brief');
}

describe('research requires at least one sourced claim', () => {
  it('asks again when every supplied claim is unsourced', () => {
    const plan = planFor(RESEARCH, { sources: 'Dental clinics in Karachi want faster booking' });
    expect(briefStep(plan)?.clarification).toMatch(/Each claim needs a source/);
    expect(briefStep(plan)?.clarificationField).toBe('sources');
  });

  it('runs the research once at least one claim carries a source', () => {
    const plan = planFor(RESEARCH, {
      sources: 'Dental clinics want faster booking\nClinics book by phone | Owner interview, March 2026',
    });
    expect(briefStep(plan)?.clarification).toBeNull();
  });

  it('still asks for sources when none are supplied', () => {
    const plan = planFor(RESEARCH, {});
    expect(briefStep(plan)?.clarification).toMatch(/Share the sources/);
  });
});

describe('leadSourceLabel', () => {
  it('keeps only the source part of the first sourced line', () => {
    expect(leadSourceLabel('Clinic owner referral | Dr. Example referral, March 2026\nsecond line')).toBe(
      'Dr. Example referral, March 2026',
    );
  });

  it('uses the whole line when it carries no separator', () => {
    expect(leadSourceLabel('Walk-in enquiry')).toBe('Walk-in enquiry');
  });

  it('never returns a multi-line blob and falls back when empty', () => {
    expect(leadSourceLabel(undefined)).toBe('unverified');
    expect(leadSourceLabel('   \n  ')).toBe('unverified');
    expect(leadSourceLabel('a\nb\nc')).not.toContain('\n');
  });

  it('is what the planner writes into create_lead', () => {
    const plan = planFor(LEAD, {
      name: 'Sindh Smile Dental Clinic',
      sources: 'Karachi has many private clinics | Owner interview notes',
    });
    const lead = plan.steps.find((step) => step.toolName === 'create_lead');
    expect(lead?.input).toMatchObject({ name: 'Sindh Smile Dental Clinic', source: 'Owner interview notes' });
  });
});
