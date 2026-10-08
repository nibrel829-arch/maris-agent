/**
 * Research, dental research, product development and visual content tools.
 *
 * Truth rules (CEO spec §8): these tools persist claims WITH their provenance.
 * A claim with an empty `source` is stored as unverified and can never be
 * presented downstream as FACT.
 */

import { z } from 'zod';
import medicalSafety from '@/knowledge/medical-safety.json';
import researchStandards from '@/knowledge/research-standards.json';
import productFramework from '@/knowledge/product-development-framework.json';
import { conductSourcedResearch } from '@/server/integrations/research/sourced-research';
import { writeAudit } from '@/server/manager/audit';
import type { ContentStatus, ResearchEvidence } from '@/types/domain';
import { defineTool } from './define';

const evidenceSchema = z.object({
  claim: z.string().min(1).max(1000),
  /** Null means the claim is unverified — required by the claim policy. */
  source: z.string().max(500).nullable(),
  grade: z.enum(['FACT', 'EVIDENCE', 'INTERPRETATION', 'RECOMMENDATION']),
  confidence: z.number().min(0).max(1),
  uncertainty: z.string().max(500).nullable().optional(),
});

export const createResearchBriefTool = defineTool({
  name: 'create_research_brief',
  description:
    'Open a structured research brief. The structure follows the documented research standard and always includes gaps and uncertainty.',
  permission: { module: 'ai', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    topic: z.string().min(1).max(200),
    question: z.string().min(1).max(500),
    domain: z.enum(['general', 'dental', 'market', 'product', 'competitor']).default('general'),
  }),
  async execute(input, ctx) {
    const medicalDomain = input.domain === 'dental';
    const brief = await ctx.repo.researchBriefs.insert({
      organization_id: ctx.organizationId,
      topic: input.topic,
      domain: input.domain,
      question: input.question,
      structure: [...researchStandards.requiredStructure],
      evidence: [],
      gaps: [
        'No evidence recorded yet. Nothing can be stated as fact until a source is recorded.',
      ],
      recommendations: [],
      medical_review_required: medicalDomain,
      created_by: ctx.actor.userId,
    });
    return { brief };
  },
});

export const addResearchEvidenceTool = defineTool({
  name: 'add_research_evidence',
  description:
    'Record evidence against a research brief. Claims without a source are stored as unverified and flagged.',
  permission: { module: 'ai', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    briefId: z.string().uuid(),
    evidence: z.array(evidenceSchema).min(1).max(50),
  }),
  async execute(input, ctx) {
    const brief = await ctx.repo.researchBriefs.get(input.briefId, ctx.organizationId);
    if (!brief) throw new Error('Research brief not found or not in this organization.');

    const normalised: ResearchEvidence[] = input.evidence.map((item) => {
      const hasSource = Boolean(item.source && item.source.trim().length > 0);
      return {
        claim: item.claim,
        source: item.source ?? null,
        // A claim with no source can never be graded FACT (claim policy).
        grade: !hasSource && item.grade === 'FACT' ? 'INTERPRETATION' : item.grade,
        confidence: hasSource ? item.confidence : Math.min(item.confidence, 0.3),
        uncertainty:
          item.uncertainty ??
          (hasSource ? null : 'No source recorded — treat as an open question, not a fact.'),
      };
    });

    const unverified = normalised.filter((item) => !item.source);

    const updated = await ctx.repo.researchBriefs.update(input.briefId, ctx.organizationId, {
      evidence: [...brief.evidence, ...normalised],
      gaps: [
        ...brief.gaps.filter((gap) => !gap.startsWith('No evidence recorded yet')),
        ...unverified.map((item) => `Unsourced claim needs verification: "${item.claim}"`),
      ],
    } as never);

    return {
      brief: updated,
      recorded: normalised.length,
      unverifiedCount: unverified.length,
      downgradedToInterpretation: normalised.filter(
        (item, index) => item.grade !== input.evidence[index]?.grade,
      ).length,
    };
  },
});

export const conductSourcedResearchTool = defineTool({
  name: 'conduct_sourced_research',
  description:
    'Retrieve source-backed web results for a research brief and store only claims tied to those URLs. Does not invent statistics, companies or sources. Blocks when web search is not configured.',
  permission: { module: 'ai', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    briefId: z.string().uuid().optional(),
    topic: z.string().min(1).max(200),
    question: z.string().min(1).max(2000),
    saveToLibrary: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    const existing = input.briefId
      ? await ctx.repo.researchBriefs.get(input.briefId, ctx.organizationId)
      : null;
    const brief =
      existing ??
      (await ctx.repo.researchBriefs.insert({
        organization_id: ctx.organizationId,
        topic: input.topic,
        domain: 'general',
        question: input.question,
        structure: [...researchStandards.requiredStructure],
        evidence: [],
        gaps: ['No evidence recorded yet.'],
        recommendations: [],
        medical_review_required: false,
        created_by: ctx.actor.userId,
      }));

    const researched = await conductSourcedResearch({ question: input.question, signal: ctx.signal });

    if (researched.status === 'needs_configuration') {
      const gap = researched.message;
      await ctx.repo.researchBriefs.update(brief.id, ctx.organizationId, {
        gaps: [...brief.gaps.filter((item) => item !== gap), gap],
      } as never);
      return {
        capabilityStatus: 'needs_configuration' as const,
        executed: false,
        brief: { ...brief, gaps: [...brief.gaps, gap] },
        sources: [],
        findings: [],
        missingConfig: researched.missing,
        message: researched.message,
      };
    }

    if (researched.status === 'error') {
      throw new Error(researched.message);
    }

    const updated = await ctx.repo.researchBriefs.update(brief.id, ctx.organizationId, {
      evidence: [...brief.evidence, ...researched.findings],
      gaps: [
        ...brief.gaps.filter((gap) => !gap.startsWith('No evidence recorded yet')),
        ...(researched.findings.length === 0
          ? ['Web search returned no usable snippets. No findings were invented.']
          : []),
      ],
      recommendations: researched.note ? [researched.note] : brief.recommendations,
    } as never);

    let contentItem = null;
    if (input.saveToLibrary && researched.findings.length > 0) {
      const body = [
        researched.note,
        '',
        ...researched.findings.map(
          (finding) => `- [${finding.grade}] ${finding.claim}\n  Source: ${finding.source}`,
        ),
      ].join('\n');
      contentItem = await ctx.repo.contentItems.insert({
        organization_id: ctx.organizationId,
        title: `Research: ${input.topic}`.slice(0, 200),
        caption: 'Sourced research notes. Not a published claim.',
        body: body.slice(0, 20000),
        status: 'DRAFT' as ContentStatus,
        platforms: [],
        media_url: null,
        created_by: ctx.actor.userId,
      });
    }

    if (researched.findings.length > 0) {
      await writeAudit(ctx.repo, ctx.actor, {
        action: 'research.sources_recorded',
        entityType: 'research_brief',
        entityId: brief.id,
        metadata: { sources: researched.sources.length, findings: researched.findings.length },
      });
    }

    return {
      capabilityStatus: 'available' as const,
      executed: true,
      brief: updated,
      sources: researched.sources,
      findings: researched.findings,
      contentItem,
      model: researched.model,
      message: researched.note,
    };
  },
});

export const listResearchBriefsTool = defineTool({
  name: 'list_research_briefs',
  description: 'List research briefs for the organization.',
  permission: { module: 'ai', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  async execute(input, ctx) {
    return ctx.repo.researchBriefs.list(ctx.organizationId, { limit: input.limit });
  },
});

export const runMedicalSafetyCheckTool = defineTool({
  name: 'run_medical_safety_check',
  description:
    'Screen text against the dental/medical safety policy. Blocks diagnosis, prescription and unsourced clinical claims (CEO spec §8).',
  permission: { module: 'ai', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ text: z.string().min(1).max(20000) }),
  async execute(input, ctx) {
    void ctx;
    const lower = input.text.toLowerCase();
    const violations = (medicalSafety.prohibitedPatterns as string[])
      .filter((pattern) => lower.includes(pattern.toLowerCase()))
      .map((pattern) => ({
        pattern,
        detail: `Text contains the restricted pattern "${pattern}". The agent must not diagnose or prescribe.`,
      }));

    return {
      safe: violations.length === 0,
      violations,
      disclaimerRequired:
        violations.length > 0 ||
        /dental|dentist|tooth|teeth|gum|oral|implant|clinical/i.test(input.text),
      disclaimer: medicalSafety.requiredDisclaimer,
      blocksDelivery: violations.length > 0,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Product development                                                         */
/* -------------------------------------------------------------------------- */

export const createProductConceptTool = defineTool({
  name: 'create_product_concept',
  description:
    'Create a product concept following the documented reasoning chain. Missing elements are stored as open questions, never invented.',
  permission: { module: 'ai', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    targetCustomer: z.string().min(1).max(500),
    problem: z.string().min(1).max(1000),
    demandSignal: z.string().max(1000).nullable().default(null),
    existingAlternatives: z.array(z.string().max(200)).max(25).default([]),
    missingOpportunity: z.string().max(1000).default(''),
    scope: z.array(z.string().max(300)).max(40).default([]),
    components: z.array(z.string().max(300)).max(40).default([]),
    versions: z.array(z.string().max(120)).max(10).default([]),
    fileTypes: z.array(z.string().max(60)).max(20).default([]),
    differentiation: z.array(z.string().max(300)).max(20).default([]),
    pricingConsiderations: z.array(z.string().max(300)).max(20).default([]),
    saveToLibrary: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    const openQuestions: string[] = [];
    const chain = productFramework.reasoningChain as string[];

    if (!input.demandSignal) openQuestions.push('Demand signal has no source yet.');
    if (input.existingAlternatives.length === 0)
      openQuestions.push('Existing alternatives have not been researched.');
    if (!input.missingOpportunity) openQuestions.push('Missing opportunity is not articulated.');
    if (input.components.length === 0) openQuestions.push('Product components are undefined.');
    if (input.pricingConsiderations.length === 0)
      openQuestions.push('Pricing considerations are undefined.');

    const concept = await ctx.repo.productConcepts.insert({
      organization_id: ctx.organizationId,
      name: input.name,
      target_customer: input.targetCustomer,
      problem: input.problem,
      demand_signal: input.demandSignal,
      alternatives: input.existingAlternatives,
      missing_opportunity: input.missingOpportunity,
      scope: input.scope,
      components: input.components,
      versions: input.versions.length ? input.versions : [...productFramework.defaultVersions],
      file_types: input.fileTypes.length ? input.fileTypes : [...productFramework.commonFileTypes],
      differentiation: input.differentiation,
      pricing_considerations: input.pricingConsiderations,
      open_questions: openQuestions,
      created_by: ctx.actor.userId,
    });

    let contentItem = null;
    if (input.saveToLibrary) {
      contentItem = await ctx.repo.contentItems.insert({
        organization_id: ctx.organizationId,
        title: input.name,
        caption: 'Product concept draft. Open questions are not resolved facts.',
        body: [
          `Problem: ${input.problem}`,
          `Target customer: ${input.targetCustomer}`,
          input.missingOpportunity ? `Opportunity gap: ${input.missingOpportunity}` : null,
          openQuestions.length ? `Open questions:\n- ${openQuestions.join('\n- ')}` : null,
        ]
          .filter(Boolean)
          .join('\n\n'),
        status: 'DRAFT' as ContentStatus,
        platforms: [],
        media_url: null,
        created_by: ctx.actor.userId,
      });
    }

    return {
      concept,
      contentItem,
      reasoningChain: chain,
      openQuestions,
      completeElements: chain.length - openQuestions.length,
    };
  },
});

export const listProductConceptsTool = defineTool({
  name: 'list_product_concepts',
  description: 'List recorded product concepts.',
  permission: { module: 'ai', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  async execute(input, ctx) {
    return ctx.repo.productConcepts.list(ctx.organizationId, { limit: input.limit });
  },
});

/* -------------------------------------------------------------------------- */
/* Visual content                                                              */
/* -------------------------------------------------------------------------- */

export const createVisualConceptTool = defineTool({
  name: 'create_visual_concept',
  description:
    'Create a visual communication concept specification: message hierarchy, formats, asset list and accessibility notes.',
  permission: { module: 'content', action: 'create' },
  risk: 'low',
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    purpose: z.string().min(1).max(500),
    formats: z.array(z.string().max(80)).min(1).max(15),
    messageHierarchy: z.array(z.string().max(300)).min(1).max(10),
    assetList: z.array(z.string().max(300)).max(40).default([]),
    saveToLibrary: z.boolean().default(false),
  }),
  async execute(input, ctx) {
    const concept = await ctx.repo.visualConcepts.insert({
      organization_id: ctx.organizationId,
      title: input.title,
      purpose: input.purpose,
      formats: input.formats,
      message_hierarchy: input.messageHierarchy,
      asset_list: input.assetList,
      accessibility_notes: [
        'Maintain contrast suitable for body text on the intended background.',
        'Provide alt text for every informative visual.',
        'Do not encode meaning in colour alone.',
      ],
      brand_consistency_notes: [
        'Check against the organization brand voice before external use.',
        'No superlative or outcome claims without recorded evidence.',
      ],
      created_by: ctx.actor.userId,
    });
    let contentItem = null;
    if (input.saveToLibrary) {
      contentItem = await ctx.repo.contentItems.insert({
        organization_id: ctx.organizationId,
        title: `${input.title} — image concept`,
        caption: 'Visual concept specification. Not a rendered image.',
        body: [
          input.purpose,
          `Formats: ${input.formats.join(', ')}`,
          `Message hierarchy: ${input.messageHierarchy.join(' → ')}`,
          'No image file has been generated by this step.',
        ].join('\n\n'),
        status: 'DRAFT' as ContentStatus,
        platforms: [],
        media_url: null,
        created_by: ctx.actor.userId,
      });
    }
    return { concept, contentItem };
  },
});

export const listVisualConceptsTool = defineTool({
  name: 'list_visual_concepts',
  description: 'List recorded visual concepts.',
  permission: { module: 'content', action: 'view' },
  risk: 'low',
  inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(25) }),
  async execute(input, ctx) {
    return ctx.repo.visualConcepts.list(ctx.organizationId, { limit: input.limit });
  },
});

export const researchTools = [
  createResearchBriefTool,
  addResearchEvidenceTool,
  conductSourcedResearchTool,
  listResearchBriefsTool,
  runMedicalSafetyCheckTool,
];

export const productTools = [createProductConceptTool, listProductConceptsTool];

export const visualTools = [createVisualConceptTool, listVisualConceptsTool];
