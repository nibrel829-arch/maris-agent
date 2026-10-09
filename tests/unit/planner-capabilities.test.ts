import { describe, expect, it } from 'vitest';
import { buildPlan, requestedWork } from '@/server/manager/planner';
import { classify, understand } from '@/server/manager/understand';

describe('multi-capability planning', () => {
  const request =
    'Research my new product, prepare an image concept, create a video draft and save all completed assets to my Content Library.';

  it('detects research, image, video and library in one request', () => {
    expect(requestedWork(request)).toEqual({
      research: true,
      image: true,
      video: true,
      library: true,
    });
  });

  it('plans dependent real tools instead of only describing the primary work type', () => {
    const understood = understand(request);
    const intent = classify(request, understood);
    const plan = buildPlan(intent, understood);
    const tools = plan.steps.map((step) => step.toolName);

    expect(tools).toContain('create_research_brief');
    expect(tools).toContain('conduct_sourced_research');
    expect(tools).toContain('create_product_concept');
    expect(tools).toContain('create_visual_concept');
    expect(tools).toContain('image.generate');
    expect(tools).not.toContain('generate_image_asset');
    expect(tools).toContain('prepare_video_draft');
    expect(tools).toContain('export_video_file');
    expect(tools.at(-1)).toBe('run_quality_check');
    expect(tools).not.toContain('publish_post');
    expect(tools).not.toContain('send_email');
    expect(plan.steps.every((step) => !step.requiresApproval)).toBe(true);
  });

  it('does not add a video export to a status report', () => {
    const understood = understand('Give me a status report');
    const plan = buildPlan(classify('Give me a status report', understood), understood);
    expect(plan.steps.some((step) => step.toolName === 'export_video_file')).toBe(false);
    expect(plan.steps.some((step) => step.toolName === 'conduct_sourced_research')).toBe(false);
  });
});
