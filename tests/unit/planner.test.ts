import { describe, expect, it } from 'vitest';
import { buildPlan } from '@/server/manager/planner';
import { classify, understand } from '@/server/manager/understand';

const planFor = (request: string) => {
  const understood = understand(request);
  const intent = classify(request, understood);
  return { intent, plan: buildPlan(intent, understood) };
};

describe('Manager planner (CEO spec §6, §7)', () => {
  it('plans research through the research skill', () => {
    const { plan } = planFor('Research the market for dental scheduling software');
    expect(plan.skills).toContain('research-intelligence');
    expect(plan.steps[0]?.toolName).toBe('create_research_brief');
  });

  it('adds a medical safety step for dental research', () => {
    const { plan } = planFor('Research dental implant aftercare protocols');
    expect(plan.skills).toContain('dental-research');
    expect(plan.steps.some((step) => step.toolName === 'run_medical_safety_check')).toBe(true);
  });

  it('reasons through the product chain end to end', () => {
    const { plan } = planFor('Build a product: a treatment planning template pack');
    expect(plan.skills).toContain('product-development');
    expect(plan.steps.some((step) => step.toolName === 'create_research_brief')).toBe(true);
    expect(plan.steps.some((step) => step.toolName === 'create_product_concept')).toBe(true);
    expect(plan.openQuestions.length).toBeGreaterThan(0);
  });

  it('always ends with the quality-control gate', () => {
    const { plan } = planFor('Draft a LinkedIn post about our new service');
    expect(plan.steps.at(-1)?.toolName).toBe('run_quality_check');
    expect(plan.steps.at(-1)?.skillId).toBe('quality-control');
  });

  it('does not plan an external publish for a pure research request', () => {
    const { plan } = planFor('Research competitor pricing');
    expect(plan.steps.some((step) => step.toolName === 'publish_post')).toBe(false);
  });

  it('marks steps with missing mandatory input as clarifications instead of guessing', () => {
    const { plan } = planFor('Create a follow-up email sequence for new enquiries');
    const prepare = plan.steps.find((step) => step.toolName === 'prepare_email');
    expect(prepare?.clarification).toMatch(/recipient email address/i);
  });

  it('uses the deterministic planner when no AI key is configured', () => {
    const { plan } = planFor('Write a caption about implant aftercare');
    expect(plan.planner).toBe('deterministic');
  });

  it('orders steps as a dependency chain', () => {
    const { plan } = planFor('Research the market for dental scheduling software');
    expect(plan.steps[0]?.dependsOn).toEqual([]);
    expect(plan.steps[1]?.dependsOn).toEqual([plan.steps[0]?.id]);
  });

  it('never requires approval for internal preparation steps', () => {
    const { plan } = planFor('Research competitor pricing');
    expect(plan.steps.every((step) => !step.requiresApproval)).toBe(true);
  });
});
