/**
 * Stage 1 — UNDERSTAND and Stage 2 — CLASSIFY (CEO spec §6, §7).
 *
 * The Manager must work out what a request actually requires rather than
 * answering literally. Classification is deterministic and auditable: it emits
 * the lexical signals it matched, so a low-confidence result can be escalated
 * instead of guessed.
 */

import type {
  DeliverableKind,
  ManagerIntent,
  UnderstoodRequest,
  WorkType,
} from '@/types/manager';

interface WorkTypeRule {
  workType: WorkType;
  signals: string[];
  weight: number;
}

/**
 * Ordered by specificity: domain-specific rules are checked before generic
 * ones so "dental research" is not swallowed by "research".
 */
const WORK_TYPE_RULES: readonly WorkTypeRule[] = [
  {
    workType: 'product_development',
    signals: [
      'build a product',
      'product concept',
      'new product',
      'product idea',
      'product scope',
      'digital product',
      'template pack',
      'create a product',
      'offer',
      'sku',
    ],
    weight: 3,
  },
  {
    workType: 'lead_generation',
    signals: ['leads', 'lead list', 'prospect', 'find customers', 'target accounts', 'outbound list'],
    weight: 3,
  },
  {
    workType: 'lead_qualification',
    signals: ['qualify', 'qualification', 'score leads', 'which leads', 'fit assessment'],
    weight: 3,
  },
  {
    workType: 'email_workflow',
    signals: ['email', 'follow-up', 'follow up', 'sequence', 'drip', 'newsletter', 'inbox email'],
    weight: 2,
  },
  {
    workType: 'outreach',
    signals: ['outreach', 'cold', 'intro email', 'reach out', 'pitch'],
    weight: 2,
  },
  {
    workType: 'sales',
    signals: ['sales', 'close', 'deal', 'pipeline', 'proposal', 'pricing', 'revenue'],
    weight: 2,
  },
  {
    workType: 'social_media',
    signals: ['social', 'post', 'instagram', 'tiktok', 'linkedin', 'youtube', 'pinterest', 'facebook', 'reel', 'publish'],
    weight: 2,
  },
  {
    workType: 'community_management',
    signals: ['community', 'comments', 'dm', 'engagement', 'moderation', 'respond to comments'],
    weight: 2,
  },
  {
    workType: 'visual_communication',
    signals: ['visual', 'design', 'graphic', 'brand', 'creative', 'thumbnail', 'carousel', 'image concept'],
    weight: 2,
  },
  {
    workType: 'content',
    signals: ['content', 'caption', 'blog', 'article', 'copy', 'script', 'write'],
    weight: 2,
  },
  {
    workType: 'marketing',
    signals: ['marketing', 'campaign', 'launch', 'positioning', 'go-to-market', 'gtm', 'awareness'],
    weight: 2,
  },
  {
    workType: 'research',
    signals: ['research', 'investigate', 'analyse', 'analyze', 'study', 'compare', 'market size', 'competitor', 'evidence', 'sources'],
    weight: 2,
  },
  {
    workType: 'reporting',
    signals: ['report', 'summary', 'metrics', 'kpi', 'dashboard', 'weekly update', 'status update'],
    weight: 2,
  },
  {
    workType: 'quality_control',
    signals: ['quality', 'review this', 'check this', 'audit', 'verify this', 'qc'],
    weight: 2,
  },
  {
    workType: 'decision_making',
    signals: ['decide', 'decision', 'should we', 'recommend', 'which option', 'trade-off', 'tradeoff'],
    weight: 2,
  },
  {
    workType: 'strategy',
    signals: ['strategy', 'strategic', 'roadmap', 'plan for', 'long-term', 'vision', 'direction'],
    weight: 2,
  },
  {
    workType: 'business_operations',
    signals: ['operations', 'process', 'workflow', 'sop', 'handbook', 'internal'],
    weight: 1,
  },
  {
    workType: 'memory_continuity',
    signals: ['remember', 'last time', 'previously', 'our preference', 'as we decided', 'context'],
    weight: 1,
  },
];

/**
 * Business qualifiers. When one of these is present the request is commercial
 * work *in* a domain, not domain research — e.g. "research the market for
 * dental software" is market research, while "research dental implant
 * aftercare" is dental research.
 */
const BUSINESS_QUALIFIERS = [
  'market',
  'competitor',
  'pricing',
  'price',
  'lead',
  'leads',
  'customer',
  'client',
  'software',
  'saas',
  'tool',
  'platform',
  'product',
  'business',
  'revenue',
  'campaign',
  'sales',
  'pipeline',
];

const MEDICAL_SIGNALS = [
  'dental',
  'dentist',
  'dentistry',
  'tooth',
  'teeth',
  'gum',
  'oral',
  'implant',
  'orthodont',
  'periodont',
  'endodont',
  'caries',
  'cavity',
  'patient',
  'symptom',
  'diagnos',
  'treatment',
  'clinical',
];

const EVIDENCE_SIGNALS = [
  'evidence',
  'source',
  'sources',
  'statistic',
  'statistics',
  'market size',
  'study',
  'research',
  'data',
  'cite',
  'citation',
  'proof',
  'percent',
  '%',
  'how many',
];

const DELIVERABLE_BY_WORK_TYPE: Record<WorkType, DeliverableKind> = {
  strategy: 'decision_memo',
  research: 'research_brief',
  dental_research: 'research_brief',
  product_development: 'product_concept',
  visual_communication: 'visual_concept',
  content: 'content_draft',
  marketing: 'campaign_plan',
  lead_generation: 'lead_list',
  lead_qualification: 'qualification_assessment',
  sales: 'sales_plan',
  outreach: 'outreach_draft',
  email_workflow: 'email_sequence',
  social_media: 'social_plan',
  community_management: 'community_plan',
  business_operations: 'operations_plan',
  quality_control: 'quality_report',
  reporting: 'business_report',
  memory_continuity: 'decision_memo',
  decision_making: 'decision_memo',
  general_orchestration: 'direct_answer',
};

function normalise(request: string): string {
  return request.toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchSignals(haystack: string, signals: readonly string[]): string[] {
  return signals.filter((signal) => haystack.includes(signal));
}

function extractEntities(request: string): Record<string, string[]> {
  const entities: Record<string, string[]> = {};

  const emails = request.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  if (emails?.length) entities.emails = [...new Set(emails)];

  const platforms = ['instagram', 'tiktok', 'youtube', 'linkedin', 'pinterest', 'facebook', 'contra'];
  const foundPlatforms = platforms.filter((p) => request.toLowerCase().includes(p));
  if (foundPlatforms.length) entities.platforms = foundPlatforms;

  const numbers = request.match(/\b\d+(\.\d+)?\s?(%|percent|k|m|days?|weeks?|months?)\b/gi);
  if (numbers?.length) entities.quantities = [...new Set(numbers)];

  const quoted = request.match(/"([^"]{2,80})"/g);
  if (quoted?.length) entities.quoted = quoted.map((q) => q.replace(/"/g, ''));

  return entities;
}

function extractConstraints(request: string): string[] {
  const constraints: string[] = [];
  const lower = normalise(request);

  if (/\b(by|before|due)\s+(monday|tuesday|wednesday|thursday|friday|today|tomorrow|\d{1,2}\/\d{1,2})\b/.test(lower)) {
    constraints.push('Has an explicit deadline.');
  }
  if (/\b(don't|do not|without|avoid|never)\b/.test(lower)) {
    constraints.push('Contains an explicit exclusion or prohibition.');
  }
  if (/\b(only|just|exactly)\b/.test(lower)) {
    constraints.push('Contains a scope restriction.');
  }
  if (/\b(budget|under|less than|max(imum)?)\s*\d/.test(lower)) {
    constraints.push('Contains a budget constraint.');
  }
  return constraints;
}

/**
 * Stage 1: rewrite the request into an objective and surface what is missing.
 * The Manager records assumptions rather than silently filling gaps.
 */
export function understand(request: string): UnderstoodRequest {
  const lower = normalise(request);
  const entities = extractEntities(request);
  const constraints = extractConstraints(request);

  const missingInformation: string[] = [];
  const assumptions: string[] = [];

  if (!entities.platforms?.length && /\b(post|publish|social|reel|carousel)\b/.test(lower)) {
    missingInformation.push('Target platform(s) were not specified.');
    assumptions.push('Assuming the organization default channels until confirmed.');
  }
  if (/\b(client|customer|lead)\b/.test(lower) && !entities.emails?.length) {
    missingInformation.push('A specific client or lead was not named.');
    assumptions.push('Assuming this applies at organization level, not to one named record.');
  }
  if (/\b(research|market|competitor)\b/.test(lower)) {
    missingInformation.push('No sources were provided with the request.');
    assumptions.push('Evidence must be sourced before any claim is stated as fact.');
  }

  return {
    request,
    objective: request.trim().replace(/\s+/g, ' '),
    entities,
    constraints,
    missingInformation,
    assumptions,
  };
}

/**
 * Stage 2: classify the request into work types and the deliverable implied.
 * Confidence is derived from match strength and is always reported.
 */
export function classify(
  request: string,
  understood: UnderstoodRequest = understand(request),
): ManagerIntent {
  const lower = normalise(request);
  const scored: Array<{ workType: WorkType; score: number; signals: string[] }> = [];

  for (const rule of WORK_TYPE_RULES) {
    const signals = matchSignals(lower, rule.signals);
    if (signals.length === 0) continue;
    scored.push({
      workType: rule.workType,
      score: signals.length * rule.weight,
      signals,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) {
    return {
      primary: 'general_orchestration',
      secondary: [],
      objective: understood.objective,
      deliverable: 'direct_answer',
      confidence: 0.4,
      signals: [],
      medicalDomain: matchSignals(lower, MEDICAL_SIGNALS).length > 0,
      requiresEvidence: false,
    };
  }

  const total = scored.reduce((sum, entry) => sum + entry.score, 0);
  const secondary = scored
    .slice(1)
    .filter((entry) => entry.score >= Math.max(2, top.score * 0.4))
    .map((entry) => entry.workType);

  const medicalSignals = matchSignals(lower, MEDICAL_SIGNALS);
  const isMedical = medicalSignals.length > 0;
  const businessQualifiers = matchSignals(lower, BUSINESS_QUALIFIERS);

  // Domain and business function are decided separately: clinical research in a
  // medical domain becomes dental_research, but commercial work that merely
  // happens to mention dentistry keeps its business work type and still gets
  // the medical safety controls.
  const primary: WorkType =
    isMedical && top.workType === 'research' && businessQualifiers.length === 0
      ? 'dental_research'
      : top.workType;

  const evidenceSignals = matchSignals(lower, EVIDENCE_SIGNALS);

  return {
    primary,
    secondary: secondary.filter((workType) => workType !== primary),
    objective: understood.objective,
    deliverable: DELIVERABLE_BY_WORK_TYPE[primary],
    confidence: Math.min(0.95, 0.35 + (top.score / Math.max(total, 1)) * 0.6),
    signals: [...top.signals, ...medicalSignals, ...evidenceSignals].slice(0, 12),
    medicalDomain: isMedical,
    requiresEvidence:
      evidenceSignals.length > 0 ||
      primary === 'research' ||
      primary === 'dental_research' ||
      primary === 'lead_generation' ||
      primary === 'reporting',
  };
}
