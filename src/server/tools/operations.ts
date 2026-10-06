/**
 * External publishing, quality control, reporting and system tools.
 */

import { z } from 'zod';
import { getSocialAdapter } from '@/server/integrations/social/adapter';
import medicalSafety from '@/knowledge/medical-safety.json';
import qualityRubric from '@/knowledge/quality-rubric.json';
import { PLATFORM_CAPABILITY_RULE } from '@/server/integrations/social/adapter';
import type { ContentStatus, SocialPlatform } from '@/types/domain';
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

/* -------------------------------------------------------------------------- */
/* External publishing                                                         */
/* -------------------------------------------------------------------------- */

export const publishPostTool = defineTool({
  name: 'publish_post',
  description:
    'EXTERNAL ACTION. Publishes content to a connected platform through its adapter. One platform failure never erases another platform result (PDF #09 §9).',
  permission: { module: 'social', action: 'publish' },
  risk: 'high',
  external: true,
  inputSchema: z.object({
    contentId: z.string().uuid(),
    accountId: z.string().uuid(),
  }),
  async execute(input, ctx) {
    const content = await ctx.repo.contentItems.get(input.contentId, ctx.organizationId);
    if (!content) throw new Error('Content not found or not in this organization.');

    const account = await ctx.repo.socialAccounts.get(input.accountId, ctx.organizationId);
    if (!account) throw new Error('Social account not found or not in this organization.');

    if (account.status !== 'connected') {
      return {
        status: 'failed' as const,
        platform: account.platform,
        reason: `Account is in "${account.status}" state. Reconnect before publishing.`,
        retryable: false,
      };
    }

    const adapter = getSocialAdapter(account.platform as SocialPlatform);
    const outcome = await adapter.publish({
      organizationId: ctx.organizationId,
      accountId: account.id,
      contentId: content.id,
      platform: account.platform as SocialPlatform,
      caption: content.caption ?? content.title,
      mediaUrl: content.media_url,
      idempotencyKey: ctx.idempotencyKey,
    });

    const status: ContentStatus =
      outcome.status === 'published' ? 'PUBLISHED' : outcome.status === 'scheduled' ? 'SCHEDULED' : 'FAILED';

    const updated = await ctx.repo.contentItems.update(input.contentId, ctx.organizationId, {
      status,
    } as never);

    return { outcome, contentItem: updated, capabilityRule: PLATFORM_CAPABILITY_RULE };
  },
});

export const schedulePostTool = defineTool({
  name: 'schedule_post',
  description:
    'EXTERNAL ACTION. Schedules content for later publication through the platform adapter. Timezone is stored explicitly (PDF #09 §10).',
  permission: { module: 'social', action: 'publish' },
  risk: 'high',
  external: true,
  inputSchema: z.object({
    contentId: z.string().uuid(),
    accountId: z.string().uuid(),
    scheduledFor: z.string().datetime({ offset: true }),
    timezone: z.string().min(1).max(64).default('UTC'),
  }),
  async execute(input, ctx) {
    const content = await ctx.repo.contentItems.get(input.contentId, ctx.organizationId);
    if (!content) throw new Error('Content not found or not in this organization.');

    const account = await ctx.repo.socialAccounts.get(input.accountId, ctx.organizationId);
    if (!account) throw new Error('Social account not found or not in this organization.');

    const adapter = getSocialAdapter(account.platform as SocialPlatform);
    const outcome = await adapter.schedule({
      organizationId: ctx.organizationId,
      accountId: account.id,
      contentId: content.id,
      platform: account.platform as SocialPlatform,
      caption: content.caption ?? content.title,
      mediaUrl: content.media_url,
      idempotencyKey: ctx.idempotencyKey,
      scheduledFor: input.scheduledFor,
    });

    if (outcome.status !== 'scheduled') {
      return {
        outcome,
        timezone: input.timezone,
        note: 'Content was not scheduled. Status below reflects the adapter result.',
      };
    }

    const updated = await ctx.repo.contentItems.update(input.contentId, ctx.organizationId, {
      status: 'SCHEDULED',
    } as never);

    return { outcome, contentItem: updated, timezone: input.timezone };
  },
});

/* -------------------------------------------------------------------------- */
/* Quality control                                                             */
/* -------------------------------------------------------------------------- */

const NUMERIC_CLAIM = /\b\d+(\.\d+)?\s*(%|percent)\b|\b\d[\d,.]*\s*(million|billion|k|m)\b/gi;
const SOURCE_HINT = /(https?:\/\/|source:|according to|doi:|pubmed|ncbi|\(.*\d{4}.*\))/i;

export const runQualityCheckTool = defineTool({
  name: 'run_quality_check',
  description:
    'Applies the documented quality rubric to output: evidence presence, claim labelling, uncertainty, medical safety, action honesty and completeness. Blocking findings prevent delivery.',
  permission: { module: 'ai', action: 'view' },
  risk: 'low',
  inputSchema: z.object({
    subject: z.string().min(1).max(200),
    /** Text or rendered JSON of the deliverable under review. */
    content: z.string().min(1).max(50000),
    medicalDomain: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    const findings: Array<{
      id: string;
      severity: 'info' | 'warning' | 'error';
      rule: string;
      detail: string;
      remediation: string;
    }> = [];

    const checks = qualityRubric.checks as Array<{
      id: string;
      severity: 'info' | 'warning' | 'error';
      description: string;
      blocking: boolean;
    }>;

    // 1. No fabricated numbers — numeric claims must carry a source hint.
    const numericClaims = input.content.match(NUMERIC_CLAIM) ?? [];
    const unsourcedNumbers = numericClaims.filter((claim) => {
      const index = input.content.indexOf(claim);
      const window = input.content.slice(Math.max(0, index - 160), index + claim.length + 160);
      return !SOURCE_HINT.test(window);
    });

    if (unsourcedNumbers.length > 0) {
      findings.push({
        id: 'no-fabricated-numbers',
        severity: 'error',
        rule: 'no-fabricated-numbers',
        detail: `Numeric claims without a source nearby: ${[...new Set(unsourcedNumbers)].slice(0, 5).join(', ')}`,
        remediation: 'Attach a retrieved source to each numeric claim or remove the number.',
      });
    }

    // 2. Medical safety.
    const lower = input.content.toLowerCase();
    const medicalViolations = (medicalSafety.prohibitedPatterns as string[]).filter((pattern) =>
      lower.includes(pattern.toLowerCase()),
    );
    if (medicalViolations.length > 0) {
      findings.push({
        id: 'medical-safety',
        severity: 'error',
        rule: 'medical-safety',
        detail: `Restricted diagnostic or prescriptive language detected: ${medicalViolations.join(', ')}`,
        remediation: 'Remove diagnostic/prescriptive language. The agent must not diagnose or prescribe.',
      });
    }

    // 3. Action honesty — "sent"/"published" claims must not appear in drafts.
    if (/\b(has been sent|was sent|has been published|published successfully)\b/i.test(input.content)) {
      findings.push({
        id: 'action-honesty',
        severity: 'error',
        rule: 'action-honesty',
        detail: 'Content asserts a completed external action. Only verified external results may be described as completed.',
        remediation: 'Reword to "prepared" / "awaiting approval" unless a provider result confirms it.',
      });
    }

    // 4. Uncertainty surfaced.
    if (input.content.length > 800 && !/\b(uncertain|unverified|unknown|assumption|gap|risk)\b/i.test(input.content)) {
      findings.push({
        id: 'uncertainty-surfaced',
        severity: 'warning',
        rule: 'uncertainty-surfaced',
        detail: 'Substantive output does not mention uncertainty, assumptions or gaps.',
        remediation: 'Add an explicit uncertainty and assumptions section.',
      });
    }

    // 5. Medical review flag.
    if (input.medicalDomain) {
      findings.push({
        id: 'medical-review-required',
        severity: 'warning',
        rule: 'medical-safety',
        detail: 'Output is in a medical/dental domain and requires professional review before external use.',
        remediation: 'Route to a qualified reviewer and include the standard disclaimer.',
      });
    }

    const blockingRuleIds = new Set(checks.filter((check) => check.blocking).map((check) => check.id));
    const blocking = findings.some(
      (finding) => finding.severity === 'error' && blockingRuleIds.has(finding.id),
    );

    const errorCount = findings.filter((f) => f.severity === 'error').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;
    const score = Math.max(0, 100 - errorCount * 30 - warningCount * 10);

    const report = await ctx.repo.qualityReports.insert({
      organization_id: ctx.organizationId,
      subject: input.subject,
      passed: !blocking,
      score,
      blocking,
      findings,
      created_by: ctx.actor.userId,
    });

    return { report, findings, score, blocking, passed: !blocking };
  },
});

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

export const buildBusinessReportTool = defineTool({
  name: 'build_business_report',
  description:
    'Aggregates real recorded workspace activity into a report. Missing data is reported as missing — it is never estimated or invented (PDF #12 §24, CEO spec §8).',
  permission: { module: 'dashboard', action: 'view' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
  }),
  async execute(input, ctx) {
    const counts = await ctx.repo.counts(ctx.organizationId);

    const [clients, leads, content, approvals] = await Promise.all([
      ctx.repo.clients.list(ctx.organizationId, { limit: 500 }),
      ctx.repo.leads.list(ctx.organizationId, { limit: 500 }),
      ctx.repo.contentItems.list(ctx.organizationId, { limit: 500 }),
      ctx.repo.approvals.list(ctx.organizationId, { limit: 200 }),
    ]);

    const statusBreakdown = clients.reduce<Record<string, number>>((acc, client) => {
      acc[client.status] = (acc[client.status] ?? 0) + 1;
      return acc;
    }, {});

    const pendingApprovals = approvals.filter((approval) => approval.status === 'pending').length;
    const contentByStatus = content.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});

    const missing: string[] = [];
    if (clients.length === 0) missing.push('No client records exist for this period.');
    if (leads.length === 0) missing.push('No lead records exist for this period.');
    if (content.length === 0) missing.push('No content records exist for this period.');

    return {
      report: {
        title: input.title,
        period: input.period,
        generatedAt: new Date().toISOString(),
        metrics: counts,
        clientStatusBreakdown: statusBreakdown,
        contentByStatus,
        leadCount: leads.length,
        qualifiedLeads: leads.filter((lead) => lead.stage === 'qualified').length,
        pendingApprovals,
      },
      missingData: missing,
      note: 'All figures are counts of records that actually exist in this workspace. No estimation was performed.',
    };
  },
});

/* -------------------------------------------------------------------------- */
/* System                                                                      */
/* -------------------------------------------------------------------------- */

export const logActivityTool = defineTool({
  name: 'log_activity',
  description: 'Write an entry to the organization audit log (PDF #05 §9).',
  permission: { module: 'dashboard', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    action: z.string().min(1).max(80),
    entityType: z.string().max(80).optional(),
    entityId: z.string().max(120).optional(),
    metadata: z.record(z.unknown()).default({}),
  }),
  async execute(input, ctx) {
    const entry = await ctx.repo.activityLogs.insert({
      organization_id: ctx.organizationId,
      actor_id: ctx.actor.userId,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      metadata: input.metadata,
    } as never);
    return { activityLog: entry };
  },
});

export const createNotificationTool = defineTool({
  name: 'create_notification',
  description: 'Create an organization notification (approvals, failures, disconnected accounts).',
  permission: { module: 'dashboard', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    body: z.string().max(2000).default(''),
    severity: z.enum(['info', 'warning', 'error']).default('info'),
  }),
  async execute(input, ctx) {
    const notification = await ctx.repo.notifications.insert({
      organization_id: ctx.organizationId,
      title: input.title,
      body: input.body,
      severity: input.severity,
      read: false,
      created_by: ctx.actor.userId,
    });
    return { notification };
  },
});

export const getSettingsTool = defineTool({
  name: 'get_settings',
  description: 'Read the effective runtime configuration. Never exposes secret values.',
  permission: { module: 'settings', action: 'view' },
  risk: 'low',
  inputSchema: z.object({}).default({}),
  async execute(_input, ctx) {
    void ctx;
    return {
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
      aiProvider: process.env.NIBREXO_AI_PROVIDER ?? 'openai',
      aiModel: process.env.NIBREXO_AI_MODEL ?? 'gpt-4o-mini',
      emailProvider: process.env.NIBREXO_EMAIL_PROVIDER ?? 'unconfigured',
      emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.NIBREXO_EMAIL_FROM),
      supabaseConfigured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
      note: 'Secret values are never returned.',
    };
  },
});

export const recordMemoryTool = defineTool({
  name: 'record_memory',
  description:
    'Store approved working context. Sensitive data must not be stored as unrestricted memory (PDF #08 §9).',
  permission: { module: 'ai', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    scope: z.string().min(1).max(80),
    key: z.string().min(1).max(120),
    value: z.unknown(),
  }),
  async execute(input, ctx) {
    const record = await ctx.repo.memory.insert({
      organization_id: ctx.organizationId,
      scope: input.scope,
      key: input.key,
      value: input.value,
      created_by: ctx.actor.userId,
    });
    return { memory: record };
  },
});

export const recallMemoryTool = defineTool({
  name: 'recall_memory',
  description: 'Recall stored working context for a scope.',
  permission: { module: 'ai', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ scope: z.string().min(1).max(80) }),
  async execute(input, ctx) {
    const all = await ctx.repo.memory.list(ctx.organizationId, { limit: 200 });
    return all.filter((record) => record.scope === input.scope);
  },
});

export const createDecisionMemoTool = defineTool({
  name: 'create_decision_memo',
  description:
    'Create a decision memo separating FACT, EVIDENCE, INTERPRETATION and RECOMMENDATION (CEO spec §8).',
  permission: { module: 'ai', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    decision: z.string().min(1).max(1000),
    facts: z.array(z.string().max(1000)).default([]),
    interpretations: z.array(z.string().max(1000)).default([]),
    recommendations: z.array(z.string().max(1000)).default([]),
    risks: z.array(z.string().max(1000)).default([]),
  }),
  async execute(input, ctx) {
    const memo = await ctx.repo.memory.insert({
      organization_id: ctx.organizationId,
      scope: 'decision_memo',
      key: input.title,
      value: {
        decision: input.decision,
        facts: input.facts,
        interpretations: input.interpretations,
        recommendations: input.recommendations,
        risks: input.risks,
        createdAt: new Date().toISOString(),
      },
      created_by: ctx.actor.userId,
    });
    return { memo };
  },
});

export const operationsTools = [
  publishPostTool,
  schedulePostTool,
  runQualityCheckTool,
  buildBusinessReportTool,
];

export const systemTools = [
  logActivityTool,
  createNotificationTool,
  getSettingsTool,
  recordMemoryTool,
  recallMemoryTool,
  createDecisionMemoTool,
];

export { PLATFORMS };
