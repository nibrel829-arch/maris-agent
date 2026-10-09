import { describe, expect, it } from 'vitest';
import { actor, repo, TEST_ORG } from '../helpers/context';
import {
  createEmailDesignTool,
  listEmailDesignsTool,
  listEmailDesignStartersTool,
  promoteEmailDesignTool,
  renderEmailDesignTool,
  updateEmailDesignTool,
} from '@/server/tools/email';
import { getTool, toolNames } from '@/server/manager/tool-registry';
import { buildPlan } from '@/server/manager/planner';
import { classify, understand } from '@/server/manager/understand';
import { validateRegistry } from '@/server/manager/skill-registry';
import { executeSteps } from '@/server/manager/execution-engine';

import type { ToolContext } from '@/types/manager';

const STUDIO_TOOLS = [
  'list_email_design_starters',
  'create_email_design',
  'list_email_designs',
  'update_email_design',
  'render_email_design',
  'promote_email_design',
];

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    actor: actor(),
    taskId: '00000000-0000-0000-0000-0000000000t1',
    organizationId: TEST_ORG,
    repo: repo(),
    runId: 'run_test',
    idempotencyKey: 'idem_test',
    ...overrides,
  };
}

describe('Manager email studio tools', () => {
  it('registers every studio tool with the skill registry', () => {
    const names = toolNames();
    const expectedPermissions: Record<string, string> = {
      list_email_design_starters: 'view',
      create_email_design: 'create',
      list_email_designs: 'view',
      update_email_design: 'edit',
      render_email_design: 'view',
      promote_email_design: 'create',
    };
    for (const name of STUDIO_TOOLS) {
      expect(names, name).toContain(name);
      expect(getTool(name)?.permission).toEqual({ module: 'email', action: expectedPermissions[name] });
    }
    // The registry invariant must hold: skills only reference real tools.
    expect(validateRegistry(names)).toEqual([]);
    expect(getTool('create_email_design')?.risk).toBe('low');
    expect(getTool('promote_email_design')?.risk).toBe('medium');
    expect(getTool('create_email_design')?.external).toBe(false);
  });

  it('lists the editable starters', async () => {
    const ctx = context();
    const starters = await listEmailDesignStartersTool.execute({}, ctx);
    expect(starters).toHaveLength(6);
    expect(starters.map((starter) => starter.id)).toContain('starter-product-launch');
    expect(starters.every((starter) => starter.blocks.length > 2)).toBe(true);
  });

  it('creates a saved, editable draft from a starter and reports the real status', async () => {
    const ctx = context();
    const created = await createEmailDesignTool.execute(
      {
        name: 'Premium product launch',
        category: 'campaign',
        subject: 'Introducing Aurora',
        starterId: 'starter-product-launch',
      },
      ctx,
    );

    expect(created.design.organization_id).toBe(TEST_ORG);
    expect(created.status).toBe('draft');
    expect(created.design.source).toBe('starter');
    expect(created.blocks.length).toBeGreaterThan(4);
    expect(created.note).toMatch(/draft/i);

    // It really is persisted and visible to the organization.
    const listed = await listEmailDesignsTool.execute({ limit: 20 }, ctx);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.design.id);
    expect(listed[0]?.status).toBe('draft');
  });

  it('refuses an unknown starter and a request with neither starter nor document', async () => {
    await expect(
      createEmailDesignTool.execute({ name: 'x', category: 'test', subject: 'x', starterId: 'starter-nope' }, context()),
    ).rejects.toThrow(/Unknown starter design/);
    await expect(
      createEmailDesignTool.execute({ name: 'x', category: 'test', subject: 'x' }, context()),
    ).rejects.toThrow(/starterId or an explicit design document/);
  });

  it('updates, renders and promotes a design through the existing template table', async () => {
    const ctx = context();
    const created = await createEmailDesignTool.execute(
      {
        name: 'Newsletter',
        category: 'newsletter',
        subject: 'Monthly update',
        starterId: 'starter-newsletter',
      },
      ctx,
    );

    const updated = await updateEmailDesignTool.execute(
      { designId: created.design.id, subject: 'Monthly update — October' },
      ctx,
    );
    expect(updated.design.subject).toBe('Monthly update — October');

    const rendered = await renderEmailDesignTool.execute(
      { designId: created.design.id, includeHtml: true, includeText: true },
      ctx,
    );
    expect(rendered.subject).toBe('Monthly update — October');
    expect(rendered.html).toContain('<!DOCTYPE html>');
    expect(rendered.validation.ok).toBe(true);
    expect(rendered.text?.length ?? 0).toBeGreaterThan(50);

    const promoted = await promoteEmailDesignTool.execute({ designId: created.design.id }, ctx);
    expect(promoted.template.status).toBe('draft');
    expect(promoted.template.bodyLength).toBeGreaterThan(500);
    expect(promoted.note).toMatch(/never activates/i);

    const templates = await ctx.repo.emailTemplates.list(TEST_ORG);
    expect(templates).toHaveLength(1);
    expect(templates[0]?.body).toContain('<!DOCTYPE html>');
  });

  it('never activates a template for sending on its own', async () => {
    const ctx = context();
    const created = await createEmailDesignTool.execute(
      {
        name: 'Announcement',
        category: 'announcement',
        subject: 'We are hiring',
        starterId: 'starter-announcement',
        status: 'active',
      },
      ctx,
    );
    expect(created.status).toBe('active');

    const promoted = await promoteEmailDesignTool.execute({ designId: created.design.id }, ctx);
    expect(promoted.template.status).toBe('draft');
  });
});

describe('Manager planning for designed emails', () => {
  const planFor = (request: string) => {
    const understood = understand(request);
    const intent = classify(request, understood);
    return buildPlan(intent, understood);
  };

  it('plans the visual studio for a product-launch design request', () => {
    const plan = planFor(
      'Create a premium product-launch email with our brand header, a full-width banner, three product cards, a video thumbnail, a CTA and our standard footer. Save it as a draft.',
    );

    const step = plan.steps.find((candidate) => candidate.toolName === 'create_email_design');
    expect(step).toBeDefined();
    expect(step?.input.starterId).toBe('starter-product-launch');
    expect(step?.input.status).toBe('draft');
    expect(plan.skills).toContain('sales-outreach-email');
  });

  it('maps the wording of the request onto the matching starter', () => {
    expect(
      planFor('Design a welcome email for new signups').steps.find((step) => step.toolName === 'create_email_design')
        ?.input.starterId,
    ).toBe('starter-welcome');
    expect(
      planFor('Build a promotional campaign email with a discount code').steps.find(
        (step) => step.toolName === 'create_email_design',
      )?.input.starterId,
    ).toBe('starter-promo');
    expect(
      planFor('Design our monthly newsletter').steps.find((step) => step.toolName === 'create_email_design')?.input
        .starterId,
    ).toBe('starter-newsletter');
  });

  it('only plans promotion when the user asks for a sendable template', () => {
    const draftOnly = planFor('Design a product launch email');
    expect(draftOnly.steps.some((step) => step.toolName === 'promote_email_design')).toBe(false);

    const promote = planFor('Design a product launch email and promote it into a template');
    expect(promote.steps.some((step) => step.toolName === 'promote_email_design')).toBe(true);
  });

  it('keeps the existing plain-template flow for sequence requests', () => {
    const plan = planFor('Create a follow-up email sequence for new enquiries');
    expect(plan.steps.some((step) => step.toolName === 'create_email_template')).toBe(true);
    expect(plan.steps.some((step) => step.toolName === 'create_email_design')).toBe(false);
    const prepare = plan.steps.find((step) => step.toolName === 'prepare_email');
    expect(prepare?.clarification).toMatch(/recipient email address/i);
  });

  it('still routes an explicit send request through the approval gate', () => {
    const plan = planFor('Design a launch email and send it to hello@nibrexo.test');
    expect(plan.steps.some((step) => step.toolName === 'create_email_design')).toBe(true);
    const send = plan.steps.find((step) => step.toolName === 'send_email');
    expect(send?.requiresApproval).toBe(true);
    expect(send?.risk).toBe('high');
  });
});

describe('Manager execution engine — Phase 16 studio request', () => {
  const planFor = (request: string) => {
    const understood = understand(request);
    const intent = classify(request, understood);
    return buildPlan(intent, understood);
  };

  it('executes the planned design step end to end and persists a real draft', async () => {
    const store = repo();
    const owner = actor();
    const plan = planFor(
      'Create a premium product-launch email with our brand header, a full-width banner, three product cards, a video thumbnail, a CTA and our standard footer. Save it as a draft.',
    );

    const outcome = await executeSteps(plan.steps, {
      actor: owner,
      repo: store,
      taskId: '00000000-0000-0000-0000-0000000000t9',
      runId: 'run_phase16',
      organizationId: TEST_ORG,
    });

    const designStep = outcome.stepResults.find(
      (result) => plan.steps.find((step) => step.id === result.stepId)?.toolName === 'create_email_design',
    );
    expect(designStep?.status).toBe('succeeded');
    const output = designStep?.output as { design: { id: string; status: string }; blocks: string[] } | undefined;
    expect(output?.design.status).toBe('draft');
    expect(output?.blocks.length).toBeGreaterThan(4);

    // The design is genuinely persisted and audited, not just returned.
    const stored = await store.emailDesigns.get(output?.design.id ?? '', TEST_ORG);
    expect(stored?.name).toBeTruthy();
    expect(stored?.organization_id).toBe(TEST_ORG);

    const audit = await store.activityLogs.list(TEST_ORG);
    expect(audit.some((row) => row.action === 'email.design.created' && row.entity_id === output?.design.id)).toBe(true);

    // No send step ran, and nothing was promoted.
    expect(outcome.stepResults.some((result) => result.status === 'succeeded' &&
      plan.steps.find((step) => step.id === result.stepId)?.toolName === 'send_email')).toBe(false);
    expect(await store.emailTemplates.list(TEST_ORG)).toHaveLength(0);
  });

  it('stops an explicit send for approval and never sends it automatically', async () => {
    const store = repo();
    const plan = planFor('Design a launch email and send it to hello@nibrexo.test');

    const outcome = await executeSteps(plan.steps, {
      actor: actor(),
      repo: store,
      taskId: '00000000-0000-0000-0000-0000000000ta',
      runId: 'run_phase16_send',
      organizationId: TEST_ORG,
    });

    // The run halts on the approval gate.
    expect(outcome.haltedOnApproval).not.toBeNull();
    expect(outcome.haltedOnApproval?.stepId).toBeTruthy();
    expect(outcome.stepResults.some((result) => result.status === 'awaiting_approval')).toBe(true);

    // Nothing was delivered.
    const logs = await store.emailLogs.list(TEST_ORG);
    expect(logs.filter((log) => log.status === 'SENT' || log.status === 'SENDING')).toHaveLength(0);
  });

  it('refuses studio tools for an actor without email permissions', async () => {
    const store = repo();
    const plan = planFor('Design a product launch email');
    const outcome = await executeSteps(plan.steps, {
      actor: actor({ role: 'client' }),
      repo: store,
      taskId: '00000000-0000-0000-0000-0000000000tb',
      runId: 'run_phase16_denied',
      organizationId: TEST_ORG,
    });

    const denied = outcome.stepResults.find(
      (result) => plan.steps.find((step) => step.id === result.stepId)?.toolName === 'create_email_design',
    );
    expect(denied?.status).toBe('denied');
    expect(denied?.issues[0]?.code).toBe('PERMISSION_DENIED');
    expect(await store.emailDesigns.list(TEST_ORG)).toHaveLength(0);
  });
});
