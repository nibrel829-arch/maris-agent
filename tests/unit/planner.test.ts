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
    const template = plan.steps.find((step) => step.toolName === 'create_email_template');
    expect(template?.clarification).toMatch(/outreach audience/i);
    expect(template?.clarificationField).toBe('audience');
    expect(plan.steps.some((step) => step.toolName === 'prepare_email')).toBe(false);
  });

  it('plans prepare_email only when a recipient is given', () => {
    const { plan } = planFor('Draft a follow-up for clinic@example.com about their enquiry');
    const prepare = plan.steps.find((step) => step.toolName === 'prepare_email');
    expect(prepare).toBeDefined();
    expect(prepare?.clarification).toBeNull();
  });

  it('keeps product, campaign and research gaps as named clarifications', () => {
    const product = planFor('Build a product: a treatment planning template pack').plan;
    const concept = product.steps.find((step) => step.toolName === 'create_product_concept');
    expect(concept?.clarificationField).toBe('targetCustomer');
    expect(concept?.input.targetCustomer).toBe('');
    expect(product.clarifications?.map((item) => item.field)).toEqual(['sources', 'targetCustomer']);

    const campaign = planFor('Create a content campaign for our spring skincare launch on instagram and linkedin').plan;
    const campaignStep = campaign.steps.find((step) => step.toolName === 'create_campaign_plan');
    expect(campaignStep?.clarificationField).toBe('audience');
    expect(JSON.stringify(campaignStep?.input)).not.toMatch(/to be confirmed/i);
  });

  it('never places placeholder text into a step input', () => {
    const requests = [
      'Build a product: a treatment planning template pack',
      'Create a content campaign for our spring skincare launch on instagram and linkedin',
      'Create a social campaign plan for instagram',
      'Prepare a focused outreach plan for dental clinics in Karachi',
      'Research the market for dental scheduling software',
    ];
    for (const request of requests) {
      const { plan } = planFor(request);
      for (const step of plan.steps) {
        expect(JSON.stringify(step.input), request).not.toMatch(/to be confirmed|to be determined|lorem ipsum/i);
      }
    }
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
