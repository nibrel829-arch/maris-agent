/**
 * Deliverable planning (Phase 17).
 *
 * Turns the SUCCEEDED step outputs of a run into deliverable specifications.
 * Every document is built from data a tool actually returned: nothing is
 * filled with placeholder text. A step whose output has no substance produces
 * no deliverable, so an empty plan can never become a file.
 *
 * This module is pure. Persisting bytes happens in `artifacts/service.ts`.
 */

import type { DeliverableKind, PlanStep, StepResult } from '@/types/manager';
import type { DocSection, DocumentModel } from '@/server/artifacts/docx';
import { toCsv } from '@/server/artifacts/csv';

export type DeliverableBody =
  | { type: 'docx'; document: DocumentModel }
  | { type: 'csv'; csv: string }
  | { type: 'html'; html: string };

export interface DeliverableSpec {
  kind: DeliverableKind;
  title: string;
  format: 'docx' | 'csv' | 'html';
  fileName: string;
  mimeType: string;
  stepId: string;
  body: DeliverableBody;
}

export const MIME_BY_FORMAT: Record<DeliverableSpec['format'], string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8',
};

type Rec = Record<string, unknown>;

const asRecord = (value: unknown): Rec => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)))
        .filter((item) => item.length > 0)
    : [];

/** Section helper: omits sections with no real content instead of printing "none". */
function section(heading: string, body: { paragraphs?: string[]; bullets?: string[]; table?: DocSection['table'] }): DocSection | null {
  const paragraphs = (body.paragraphs ?? []).filter((item) => item.trim().length > 0);
  const bullets = (body.bullets ?? []).filter((item) => item.trim().length > 0);
  const hasTable = Boolean(body.table && body.table.rows.length > 0);
  if (paragraphs.length === 0 && bullets.length === 0 && !hasTable) return null;
  return { heading, paragraphs, bullets, ...(hasTable ? { table: body.table } : {}) };
}

function sections(...items: Array<DocSection | null>): DocSection[] {
  return items.filter((item): item is DocSection => item !== null);
}

function slug(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'deliverable';
}

function docSpec(
  kind: DeliverableKind,
  step: PlanStep,
  title: string,
  subtitle: string,
  meta: Array<[string, string]>,
  body: DocSection[],
  generatedAt: string,
  notice?: string,
): DeliverableSpec | null {
  if (body.length === 0) return null;
  const document: DocumentModel = {
    title,
    subtitle,
    meta: meta.filter(([, value]) => value.length > 0),
    ...(notice ? { notice } : {}),
    sections: body,
    generatedAt,
  };
  return {
    kind,
    title,
    format: 'docx',
    fileName: `${slug(title)}.docx`,
    mimeType: MIME_BY_FORMAT.docx,
    stepId: step.id,
    body: { type: 'docx', document },
  };
}

export interface DeliverableInput {
  steps: readonly PlanStep[];
  results: readonly StepResult[];
  request: string;
  generatedAt: string;
  /** Renders an Email Studio design row to HTML. Injected to keep this module pure. */
  renderEmailDesign?: (design: Rec) => string | null;
}

/** Plans one deliverable per succeeded output that has real content. */
export function buildDeliverableSpecs(input: DeliverableInput): DeliverableSpec[] {
  const specs: DeliverableSpec[] = [];
  const { generatedAt } = input;
  const stepById = new Map(input.steps.map((step) => [step.id, step]));

  // Research briefs: the latest record of each brief is the deliverable.
  const briefOutputs = input.results.filter(
    (result) =>
      result.status === 'succeeded' &&
      (result.toolName === 'create_research_brief' || result.toolName === 'add_research_evidence'),
  );
  const latestBriefResult = briefOutputs[briefOutputs.length - 1];
  if (latestBriefResult) {
    const step = stepById.get(latestBriefResult.stepId);
    const brief = asRecord(asRecord(latestBriefResult.output).brief);
    const evidence = Array.isArray(brief.evidence) ? (brief.evidence as Rec[]) : [];
    if (step && evidence.length > 0) {
      const topic = text(brief.topic) || 'Research';
      const unverified = evidence.filter((item) => !text(item.source)).length;
      const spec = docSpec(
        'research_brief',
        step,
        `Research brief: ${topic}`,
        'Structured research brief built from the sources supplied to the Manager.',
        [
          ['Domain', text(brief.domain)],
          ['Question', text(brief.question)],
          ['Evidence items', String(evidence.length)],
          ['Unverified items', String(unverified)],
        ],
        sections(
          section('Evidence', {
            table: {
              headers: ['Claim', 'Source', 'Grade', 'Confidence'],
              rows: evidence.map((item) => [
                text(item.claim),
                text(item.source) || 'No source recorded',
                text(item.grade),
                typeof item.confidence === 'number' ? item.confidence.toFixed(2) : '',
              ]),
            },
          }),
          section('Gaps and uncertainty', { bullets: list(brief.gaps) }),
          section('Recommendations', { bullets: list(brief.recommendations) }),
          section('Research standard', { bullets: list(brief.structure) }),
        ),
        generatedAt,
        unverified > 0 ? 'Some claims have no recorded source. Treat them as open questions, not facts.' : undefined,
      );
      if (spec) specs.push(spec);
    }
  }

  for (const result of input.results) {
    if (result.status !== 'succeeded' || result.output === null) continue;
    const step = stepById.get(result.stepId);
    if (!step) continue;
    const output = asRecord(result.output);

    switch (result.toolName) {
      case 'create_product_concept': {
        const concept = asRecord(output.concept);
        const name = text(concept.name) || 'Product concept';
        const spec = docSpec(
          'product_concept',
          step,
          `Product concept: ${name}`,
          'Product concept assembled from the recorded research and the confirmed target customer.',
          [['Target customer', text(concept.target_customer)]],
          sections(
            section('Problem', { paragraphs: [text(concept.problem)] }),
            section('Demand signal', { paragraphs: [text(concept.demand_signal)] }),
            section('Existing alternatives', { bullets: list(concept.alternatives) }),
            section('Missing opportunity', { paragraphs: [text(concept.missing_opportunity)] }),
            section('Scope', { bullets: list(concept.scope) }),
            section('Components', { bullets: list(concept.components) }),
            section('Versions', { bullets: list(concept.versions) }),
            section('File types', { bullets: list(concept.file_types) }),
            section('Differentiation', { bullets: list(concept.differentiation) }),
            section('Pricing considerations', { bullets: list(concept.pricing_considerations) }),
            section('Open questions', { bullets: list(concept.open_questions) }),
          ),
          generatedAt,
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'create_campaign_plan': {
        const plan = asRecord(output.campaignPlan);
        const title = text(plan.title) || 'Campaign plan';
        const spec = docSpec(
          'campaign_plan',
          step,
          `Campaign plan: ${title}`,
          'Campaign plan with objective, audience, channels and messages.',
          [['Audience', text(plan.audience)]],
          sections(
            section('Objective', { paragraphs: [text(plan.objective)] }),
            section('Audience', { paragraphs: [text(plan.audience)] }),
            section('Channels', { bullets: list(plan.channels) }),
            section('Key messages', { bullets: list(plan.messages) }),
            section('Timeline', { bullets: list(plan.timeline) }),
            section('Success measures', { bullets: list(plan.success_measures) }),
          ),
          generatedAt,
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'create_social_plan': {
        const plan = asRecord(output.socialPlan);
        const title = text(plan.title) || 'Social plan';
        const spec = docSpec(
          'social_plan',
          step,
          `Social plan: ${title}`,
          'Social publishing plan. Nothing has been published.',
          [['Cadence', text(plan.cadence)]],
          sections(
            section('Platforms', { bullets: list(plan.platforms) }),
            section('Cadence', { paragraphs: [text(plan.cadence)] }),
            section('Themes', { bullets: list(plan.themes) }),
            section('Content pillars', { bullets: list(plan.content_pillars) }),
          ),
          generatedAt,
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'create_community_plan': {
        const plan = asRecord(output.communityPlan);
        const title = text(plan.title) || 'Community plan';
        const spec = docSpec(
          'community_plan',
          step,
          `Community plan: ${title}`,
          'Community management plan. No replies have been posted.',
          [],
          sections(
            section('Channels', { bullets: list(plan.channels) }),
            section('Response guidelines', { bullets: list(plan.response_guidelines) }),
            section('Escalation rules', { bullets: list(plan.escalation_rules) }),
            section('Engagement rituals', { bullets: list(plan.engagement_rituals) }),
          ),
          generatedAt,
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'create_content_item': {
        const item = asRecord(output.contentItem);
        const title = text(item.title) || 'Content draft';
        const captions = results(input.results, 'generate_caption');
        const copySections = captions.map((caption) => {
          const copy = asRecord(caption.output);
          const label = copy.aiPhrasing === false ? 'Copy skeleton (not AI-phrased, review before use)' : 'Platform copy';
          return section(label, {
            paragraphs: [text(copy.hook), text(copy.caption)].filter(Boolean),
            bullets: list(copy.hashtags),
          });
        });
        const spec = docSpec(
          'content_draft',
          step,
          `Content draft: ${title}`,
          'Draft content. Status is DRAFT; nothing has been published.',
          [['Platforms', list(item.platforms).join(', ')], ['Status', 'DRAFT']],
          sections(section('Body', { paragraphs: [text(item.body) || text(item.caption)] }), ...copySections),
          generatedAt,
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'create_email_template': {
        const template = asRecord(output.template);
        const audience = text(step.input.audience);
        const subject = text(template.subject);
        const spec = docSpec(
          'outreach_draft',
          step,
          `Outreach draft: ${text(template.name) || subject || 'Email template'}`,
          'Email template draft. Nothing has been sent.',
          [['Audience', audience], ['Subject', subject], ['Category', text(template.category)]],
          sections(
            section('Audience', { paragraphs: [audience] }),
            section('Subject line', { paragraphs: [subject] }),
            section('Message', { paragraphs: [text(template.body)] }),
            section('Variables to personalise', { bullets: list(template.variables) }),
          ),
          generatedAt,
          'Draft only. Review every personalised field before any send.',
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'prepare_email': {
        const log = asRecord(output.emailLog);
        // prepare_email stores plain text. It is escaped before it becomes HTML.
        const plain = typeof log.body === 'string' ? log.body : '';
        if (plain.trim()) {
          specs.push({
            kind: 'email_draft',
            title: `Email draft: ${text(log.subject) || 'Untitled'}`,
            format: 'html',
            fileName: `${slug(text(log.subject) || 'email-draft')}.html`,
            mimeType: MIME_BY_FORMAT.html,
            stepId: step.id,
            body: { type: 'html', html: wrapDraftHtml(text(log.subject), escapeHtml(plain).replace(/\r?\n/g, '<br>')) },
          });
        }
        break;
      }
      case 'create_email_design': {
        const design = asRecord(output.design);
        const html = input.renderEmailDesign?.(design) ?? null;
        if (html) {
          const name = text(design.name) || 'Email design';
          specs.push({
            kind: 'email_design',
            title: `Email design: ${name}`,
            format: 'html',
            fileName: `${slug(name)}.html`,
            mimeType: MIME_BY_FORMAT.html,
            stepId: step.id,
            body: { type: 'html', html },
          });
        }
        break;
      }
      case 'create_decision_memo': {
        const memo = asRecord(asRecord(output.memo).value);
        const title = text(step.input.title) || 'Decision memo';
        const facts = list(memo.facts);
        const spec = docSpec(
          'decision_memo',
          step,
          `Decision memo: ${title}`,
          'Decision memo. Facts, interpretations and recommendations are kept separate.',
          [['Decision', text(memo.decision)]],
          sections(
            section('Decision question', { paragraphs: [text(memo.decision)] }),
            section('Facts', { bullets: facts.length ? facts : ['No verified facts were supplied to this memo.'] }),
            section('Interpretations', { bullets: list(memo.interpretations) }),
            section('Recommendations', { bullets: list(memo.recommendations) }),
            section('Risks', { bullets: list(memo.risks) }),
          ),
          generatedAt,
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'build_business_report': {
        const report = asRecord(output.report);
        const title = text(report.title) || text(step.input.title) || 'Business report';
        const body = Object.entries(report)
          .filter(([key]) => key !== 'title')
          .map(([key, value]) => section(labelise(key), flattenValue(value)))
          .filter((item): item is DocSection => item !== null);
        const missing = list(output.missingData);
        const spec = docSpec(
          'business_report',
          step,
          `Business report: ${title}`,
          'Report built from recorded workspace activity. Missing data is listed, not estimated.',
          [],
          [...body, ...(missing.length ? [section('Missing data', { bullets: missing })].filter((item): item is DocSection => item !== null) : [])],
          generatedAt,
        );
        if (spec) specs.push(spec);
        break;
      }
      case 'create_lead': {
        const lead = asRecord(output.lead);
        if (!text(lead.name)) break;
        specs.push({
          kind: 'lead_list',
          title: `Lead: ${text(lead.name)}`,
          format: 'csv',
          fileName: `${slug(text(lead.name))}-lead.csv`,
          mimeType: MIME_BY_FORMAT.csv,
          stepId: step.id,
          body: {
            type: 'csv',
            csv: toCsv(
              ['name', 'company', 'email', 'source', 'status'],
              [[text(lead.name), text(lead.company), text(lead.email), text(lead.source), text(lead.status)]],
            ),
          },
        });
        break;
      }
      default:
        break;
    }
  }

  return specs;
}

function results(all: readonly StepResult[], toolName: string): StepResult[] {
  return all.filter((result) => result.status === 'succeeded' && result.toolName === toolName);
}

function labelise(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Converts a report value into printable paragraphs and bullets. */
function flattenValue(value: unknown): { paragraphs?: string[]; bullets?: string[] } {
  if (value === null || value === undefined) return {};
  if (Array.isArray(value)) {
    return { bullets: value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))) };
  }
  if (typeof value === 'object') {
    return {
      bullets: Object.entries(value as Rec).map(([key, inner]) => `${labelise(key)}: ${typeof inner === 'object' ? JSON.stringify(inner) : String(inner)}`),
    };
  }
  return { paragraphs: [String(value)] };
}

export function escapeHtml(value: string): string {
  return value.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function wrapDraftHtml(subject: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body>${bodyHtml}</body></html>`;
}
