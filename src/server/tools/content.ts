/**
 * Content, marketing, social and community tools.
 *
 * Internal preparation is always low risk. Anything that leaves the system
 * (publish, schedule, send) is declared `external: true`, runs behind an
 * adapter, and stops for approval (PDF #09 §19, CEO spec §9).
 */

import { z } from 'zod';
import brandVoice from '@/knowledge/brand-voice.json';
import type { ContentStatus } from '@/types/domain';
import { defineTool } from './define';

const PLATFORMS = [
  'tiktok',
  'youtube',
  'pinterest',
  'linkedin',
  'instagram',
  'facebook',
  'contra',
] as const;

export const createContentItemTool = defineTool({
  name: 'create_content_item',
  description: 'Create a content draft. Drafts never auto-publish (PDF #04 §7).',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    caption: z.string().max(5000).optional(),
    body: z.string().max(20000).optional(),
    platforms: z.array(z.enum(PLATFORMS)).max(7).default([]),
    mediaUrl: z.string().max(1000).optional(),
  }),
  async execute(input, ctx) {
    const item = await ctx.repo.contentItems.insert({
      organization_id: ctx.organizationId,
      title: input.title,
      caption: input.caption ?? null,
      body: input.body ?? null,
      status: 'DRAFT' as ContentStatus,
      platforms: [...input.platforms],
      media_url: input.mediaUrl ?? null,
      created_by: ctx.actor.userId,
    });
    return { contentItem: item };
  },
});

export const updateContentItemTool = defineTool({
  name: 'update_content_item',
  description: 'Update a content item.',
  permission: { module: 'content', action: 'edit' },
  risk: 'medium',
  inputSchema: z.object({
    contentId: z.string().uuid(),
    title: z.string().min(1).max(200).optional(),
    caption: z.string().max(5000).optional(),
    body: z.string().max(20000).optional(),
    platforms: z.array(z.enum(PLATFORMS)).max(7).optional(),
    status: z
      .enum([
        'DRAFT',
        'VALIDATING',
        'READY',
        'SCHEDULED',
        'PUBLISHING',
        'PUBLISHED',
        'PARTIAL',
        'FAILED',
        'CANCELLED',
      ])
      .optional(),
  }),
  async execute(input, ctx) {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.caption !== undefined) patch.caption = input.caption;
    if (input.body !== undefined) patch.body = input.body;
    if (input.platforms !== undefined) patch.platforms = input.platforms;
    if (input.status !== undefined) patch.status = input.status;

    const contentItem = await ctx.repo.contentItems.update(
      input.contentId,
      ctx.organizationId,
      patch as never,
    );
    if (!contentItem) throw new Error('Content item not found or not in this organization.');
    return { contentItem };
  },
});

export const listContentItemsTool = defineTool({
  name: 'list_content_items',
  description: 'List content items for the organization.',
  permission: { module: 'content', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  async execute(input, ctx) {
    return ctx.repo.contentItems.list(ctx.organizationId, { limit: input.limit });
  },
});

export const generateCaptionTool = defineTool({
  name: 'generate_caption',
  description:
    'Generate a caption, hook and hashtags for a platform and tone. Copy follows the organization brand voice and contains no unsupported claims. Availability of AI phrasing depends on the configured provider; when no provider key is present the tool returns a structured copy skeleton rather than imitating an AI result.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    topic: z.string().min(1).max(300),
    platform: z.enum(PLATFORMS),
    tone: z.enum(['professional', 'conversational', 'educational', 'bold']).default('professional'),
    objective: z.string().max(300).optional(),
  }),
  async execute(input, ctx) {
    void ctx;
    const channelGuidance =
      (brandVoice.channels as Record<string, string>)[input.platform] ?? brandVoice.tone;

    return {
      platform: input.platform,
      tone: input.tone,
      hook: `${input.topic} — the practical version.`,
      caption: [
        `${input.topic}.`,
        input.objective ? `Objective: ${input.objective}` : null,
        channelGuidance,
      ]
        .filter(Boolean)
        .join(' '),
      hashtags: ['#nibrexo', `#${input.platform}`, `#${input.tone}`],
      claims: [] as string[],
      aiPhrasing: false,
      note: 'Structured copy skeleton. AI phrasing is applied only when a provider key is configured.',
    };
  },
});

export const createCampaignPlanTool = defineTool({
  name: 'create_campaign_plan',
  description: 'Create a marketing campaign plan.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    objective: z.string().min(1).max(500),
    audience: z.string().min(1).max(500),
    channels: z.array(z.enum(PLATFORMS)).min(1).max(7),
    messages: z.array(z.string().max(500)).min(1).max(15),
    timeline: z.array(z.string().max(200)).max(30).default([]),
    successMeasures: z.array(z.string().max(300)).max(15).default([]),
  }),
  async execute(input, ctx) {
    const plan = await ctx.repo.campaignPlans.insert({
      organization_id: ctx.organizationId,
      title: input.title,
      objective: input.objective,
      audience: input.audience,
      channels: [...input.channels],
      messages: input.messages,
      timeline: input.timeline,
      success_measures: input.successMeasures,
      created_by: ctx.actor.userId,
    });
    return { campaignPlan: plan };
  },
});

export const listCampaignPlansTool = defineTool({
  name: 'list_campaign_plans',
  description: 'List campaign plans.',
  permission: { module: 'content', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  async execute(input, ctx) {
    return ctx.repo.campaignPlans.list(ctx.organizationId, { limit: input.limit });
  },
});

/* -------------------------------------------------------------------------- */
/* Social & community                                                          */
/* -------------------------------------------------------------------------- */

export const listSocialAccountsTool = defineTool({
  name: 'list_social_accounts',
  description:
    'List connected social accounts and their verified capability map. Capabilities reflect only what the official platform API supports.',
  permission: { module: 'social', action: 'view' },
  risk: 'low',
  inputSchema: z.object({}).default({}),
  async execute(_input, ctx) {
    return ctx.repo.socialAccounts.list(ctx.organizationId, { limit: 50 });
  },
});

export const createSocialPlanTool = defineTool({
  name: 'create_social_plan',
  description: 'Create a social publishing plan (cadence, themes, pillars).',
  permission: { module: 'social', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    platforms: z.array(z.enum(PLATFORMS)).min(1).max(7),
    cadence: z.string().min(1).max(200),
    themes: z.array(z.string().max(300)).min(1).max(20),
    contentPillars: z.array(z.string().max(300)).min(1).max(15),
  }),
  async execute(input, ctx) {
    const plan = await ctx.repo.socialPlans.insert({
      organization_id: ctx.organizationId,
      title: input.title,
      platforms: [...input.platforms],
      cadence: input.cadence,
      themes: input.themes,
      content_pillars: input.contentPillars,
      created_by: ctx.actor.userId,
    });
    return { socialPlan: plan };
  },
});

export const createCommunityPlanTool = defineTool({
  name: 'create_community_plan',
  description: 'Create a community management plan with response guidelines and escalation rules.',
  permission: { module: 'inbox', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    channels: z.array(z.enum(PLATFORMS)).min(1).max(7),
    responseGuidelines: z.array(z.string().max(500)).min(1).max(20),
    escalationRules: z.array(z.string().max(500)).max(20).default([]),
    engagementRituals: z.array(z.string().max(500)).max(20).default([]),
  }),
  async execute(input, ctx) {
    const plan = await ctx.repo.communityPlans.insert({
      organization_id: ctx.organizationId,
      title: input.title,
      channels: [...input.channels],
      response_guidelines: input.responseGuidelines,
      escalation_rules: input.escalationRules,
      engagement_rituals: input.engagementRituals,
      created_by: ctx.actor.userId,
    });
    return { communityPlan: plan };
  },
});

export const contentTools = [
  createContentItemTool,
  updateContentItemTool,
  listContentItemsTool,
  generateCaptionTool,
  createCampaignPlanTool,
  listCampaignPlansTool,
];

export const socialTools = [
  listSocialAccountsTool,
  createSocialPlanTool,
  createCommunityPlanTool,
];
