/**
 * Stage 3 — PLAN and Stage 4 — SELECT REQUIRED SKILLS (CEO spec §6, §7).
 *
 * The planner decides which skills are needed, in what order, with which tool
 * inputs, and what must be verified. It never invents an input it does not
 * have: unresolved mandatory inputs become clarifications and the step is
 * skipped rather than guessed.
 */

import { z } from 'zod';
import type {
  ManagerIntent,
  ManagerPlan,
  PlanStep,
  SkillId,
  UnderstoodRequest,
} from '@/types/manager';
import { getSkill, skillsForWorkType } from './skill-registry';
import { getTool, hasTool } from './tool-registry';
import { evaluateApproval } from './approval-policy';
import { stepRef } from './input-resolver';

const stepIndexSchema = z.object({
  steps: z
    .array(
      z.object({
        stepId: z.string(),
        rationale: z.string().max(500),
      }),
    )
    .max(40),
  openQuestions: z.array(z.string().max(500)).max(15),
});

interface StepDraft {
  title: string;
  rationale: string;
  skillId: SkillId;
  toolName: string | null;
  input: Record<string, unknown>;
  stage: PlanStep['stage'];
  clarification?: string | null;
  dependsOn?: string[];
}

/** Deterministic step templates per work type. */
function templates(
  intent: ManagerIntent,
  understood: UnderstoodRequest,
): { steps: StepDraft[]; openQuestions: string[] } {
  const request = understood.objective;
  const openQuestions: string[] = [...understood.missingInformation];
  const steps: StepDraft[] = [];

  const platformList = (understood.entities.platforms ?? []) as string[];
  const emailList = (understood.entities.emails ?? []) as string[];
  const quoted = (understood.entities.quoted ?? []) as string[];
  const topic = quoted[0] ?? request.slice(0, 120);

  switch (intent.primary) {
    case 'dental_research':
    case 'research': {
      const skill: SkillId = intent.medicalDomain ? 'dental-research' : 'research-intelligence';
      steps.push({
        title: 'Open a structured research brief',
        rationale:
          'The request needs evidence. A brief fixes the question, method and gaps before any claim is made.',
        skillId: skill,
        toolName: 'create_research_brief',
        input: {
          topic: topic.slice(0, 200),
          question: request,
          domain: intent.medicalDomain ? 'dental' : 'general',
        },
        stage: 'execute',
      });
      if (intent.medicalDomain) {
        steps.push({
          title: 'Screen the brief for medical safety',
          rationale: 'Dental output must not diagnose or prescribe (CEO spec §8).',
          skillId: 'dental-research',
          toolName: 'run_medical_safety_check',
          input: { text: request },
          stage: 'verify',
        });
      }
      openQuestions.push(
        'Which sources should be recorded against this brief? No claim can be stated as fact without one.',
      );
      break;
    }

    case 'product_development': {
      steps.push({
        title: 'Research demand and alternatives',
        rationale: 'A product concept needs a demand signal and known alternatives before scope is set.',
        skillId: 'research-intelligence',
        toolName: 'create_research_brief',
        input: { topic: topic.slice(0, 200), question: `Demand and alternatives for: ${request}`, domain: 'market' },
        stage: 'execute',
      });
      steps.push({
        title: 'Create the product concept',
        rationale: 'Applies the documented reasoning chain from target customer through quality control.',
        skillId: 'product-development',
        toolName: 'create_product_concept',
        input: {
          name: topic.slice(0, 200),
          targetCustomer: 'To be confirmed — recorded as an open question rather than assumed.',
          problem: request,
          demandSignal: null,
          existingAlternatives: [],
          missingOpportunity: '',
        },
        stage: 'execute',
      });
      openQuestions.push('Who is the target customer? This must be confirmed to complete the concept.');
      break;
    }

    case 'content':
    case 'visual_communication':
    case 'marketing': {
      if (intent.primary === 'visual_communication') {
        if (wantsDesignedEmail(request)) {
          steps.push(emailDesignStep(request, topic, intent, steps));
        } else {
          steps.push({
            title: 'Create a visual concept specification',
            rationale: 'Visual work starts with message hierarchy, formats and asset list.',
            skillId: 'visual-content',
            toolName: 'create_visual_concept',
            input: { title: topic.slice(0, 200), purpose: request, formats: ['social-square'], messageHierarchy: [topic] },
            stage: 'execute',
          });
        }
      }
      steps.push({
        title: 'Draft the content asset',
        rationale: 'Content is created as a draft; it never auto-publishes (PDF #04 §7).',
        skillId: 'content-marketing',
        toolName: 'create_content_item',
        input: { title: topic.slice(0, 200), body: request, platforms: platformList },
        stage: 'execute',
      });
      steps.push({
        title: 'Generate platform copy',
        rationale: 'Provides hook, caption and hashtags under the organization brand voice.',
        skillId: 'content-marketing',
        toolName: 'generate_caption',
        input: { topic: topic.slice(0, 300), platform: platformList[0] ?? 'linkedin', objective: request },
        stage: 'execute',
      });
      if (intent.primary === 'marketing') {
        steps.push({
          title: 'Create the campaign plan',
          rationale: 'Marketing requests need objective, audience, channels and success measures.',
          skillId: 'content-marketing',
          toolName: 'create_campaign_plan',
          input: {
            title: topic.slice(0, 200),
            objective: request,
            audience: 'To be confirmed.',
            channels: platformList.length ? platformList : ['linkedin'],
            messages: [topic],
          },
          stage: 'execute',
        });
      }
      if (platformList.length === 0) {
        openQuestions.push('Which platforms should this content target?');
      }
      break;
    }

    case 'social_media': {
      steps.push({
        title: 'Check connected accounts and capabilities',
        rationale: 'Publishing is only possible where the official API supports it (PDF #09 §14).',
        skillId: 'social-community',
        toolName: 'list_social_accounts',
        input: {},
        stage: 'execute',
      });
      steps.push({
        title: 'Create a social plan',
        rationale: 'Establishes cadence, themes and content pillars before publishing.',
        skillId: 'social-community',
        toolName: 'create_social_plan',
        input: {
          title: topic.slice(0, 200),
          platforms: platformList.length ? platformList : ['linkedin'],
          cadence: 'To be confirmed.',
          themes: [topic],
          contentPillars: [topic],
        },
        stage: 'execute',
      });
      const contentStepId = `step-${steps.length + 1}`;
      steps.push({
        title: 'Draft the post',
        rationale: 'Content must exist and be approved before any external publish.',
        skillId: 'content-marketing',
        toolName: 'create_content_item',
        input: { title: topic.slice(0, 200), body: request, platforms: platformList },
        stage: 'execute',
      });

      if (wantsExternalAction(request, 'publish')) {
        steps.push({
          title: 'Publish the post to the connected account',
          rationale:
            'Publishing is an external action. It stops for approval and only runs where the official platform API supports it.',
          skillId: 'social-community',
          toolName: 'publish_post',
          input: {
            contentId: stepRef(contentStepId, 'contentItem.id'),
            accountId: stepRef('step-1', '0.id'),
          },
          stage: 'execute',
        });
      }
      break;
    }

    case 'community_management': {
      steps.push({
        title: 'Review connected community channels',
        rationale: 'Community work depends on which channels are actually connected.',
        skillId: 'social-community',
        toolName: 'list_social_accounts',
        input: {},
        stage: 'execute',
      });
      steps.push({
        title: 'Create a community plan',
        rationale: 'Defines response guidelines, escalation rules and engagement rituals.',
        skillId: 'social-community',
        toolName: 'create_community_plan',
        input: {
          title: topic.slice(0, 200),
          channels: platformList.length ? platformList : ['instagram'],
          responseGuidelines: ['Respond within one business day.', 'Escalate complaints to a human.'],
        },
        stage: 'execute',
      });
      break;
    }

    case 'lead_generation':
    case 'lead_qualification': {
      steps.push({
        title: 'Define lead criteria and sources',
        rationale: 'Lead work must record where each candidate came from; nothing is invented.',
        skillId: 'lead-generation',
        toolName: 'create_research_brief',
        input: { topic: topic.slice(0, 200), question: `Lead criteria and sources for: ${request}`, domain: 'market' },
        stage: 'execute',
      });
      steps.push({
        title: 'Record a lead',
        rationale: 'Persists a candidate with its provenance.',
        skillId: 'lead-generation',
        toolName: 'create_lead',
        input: { name: topic.slice(0, 200), source: 'unverified' },
        clarification:
          'No lead name, company and source were supplied. Provide them so the system can record a real lead rather than a placeholder.',
        stage: 'execute',
      });
      if (intent.primary === 'lead_qualification') {
        steps.push({
          title: 'Qualify leads against recorded evidence',
          rationale: 'Scoring uses only criteria with recorded evidence.',
          skillId: 'lead-generation',
          toolName: 'qualify_lead',
          input: {},
          clarification: 'A lead id and scored criteria are required to qualify a lead.',
          stage: 'execute',
        });
      }
      break;
    }

    case 'sales':
    case 'outreach':
    case 'email_workflow': {
      const designedEmail = wantsDesignedEmail(request);

      if (designedEmail) {
        steps.push(emailDesignStep(request, topic, intent, steps));

        if (wantsPromotion(request)) {
          steps.push({
            title: 'Promote the design into a sending template',
            rationale:
              'The rendered design is written into the existing email_templates table as a draft. Sending still requires email:send and the existing approval gates.',
            skillId: 'sales-outreach-email',
            toolName: 'promote_email_design',
            input: { designId: stepRef(`step-${steps.length}`, 'design.id'), status: 'draft' },
            stage: 'execute',
          });
        }
      } else {
        steps.push({
          title: 'Draft the email template',
          rationale: 'Standardizes the message and validates variables before personalization.',
          skillId: 'sales-outreach-email',
          toolName: 'create_email_template',
          input: {
            name: topic.slice(0, 200),
            category: intent.primary === 'outreach' ? 'outreach' : 'sales',
            subject: topic.slice(0, 200),
            body: `Hi {{contact.name}},\n\n${request}\n\nKind regards,\n{{user.name}}`,
          },
          stage: 'execute',
        });
      }

      const prepareStepId = `step-${steps.length + 1}`;
      steps.push({
        title: 'Prepare the personalized email',
        rationale: 'Preparation is internal. Nothing is sent at this stage (CEO spec §9).',
        skillId: 'sales-outreach-email',
        toolName: 'prepare_email',
        input: {
          toEmail: emailList[0] ?? '',
          subject: topic.slice(0, 200),
          body: request,
        },
        clarification:
          emailList.length === 0
            ? 'No recipient email address was supplied. Provide one so the email can be prepared.'
            : null,
        stage: 'execute',
      });

      if (wantsExternalAction(request, 'send')) {
        steps.push({
          title: 'Send the prepared email',
          rationale:
            'Sending is external, irreversible and high impact. It stops for explicit approval and runs only through a configured provider adapter.',
          skillId: 'sales-outreach-email',
          toolName: 'send_email',
          input: { emailLogId: stepRef(prepareStepId, 'emailLog.id') },
          stage: 'execute',
        });
      }
      break;
    }

    case 'reporting': {
      steps.push({
        title: 'Build the business report',
        rationale: 'Aggregates only records that actually exist; missing data is reported as missing.',
        skillId: 'business-reporting',
        toolName: 'build_business_report',
        input: { title: topic.slice(0, 200), period: '30d' },
        stage: 'execute',
      });
      break;
    }

    case 'quality_control': {
      steps.push({
        title: 'Run the quality rubric',
        rationale: 'Applies evidence, medical safety and action-honesty checks.',
        skillId: 'quality-control',
        toolName: 'run_quality_check',
        input: { subject: topic.slice(0, 200), content: request, medicalDomain: intent.medicalDomain },
        stage: 'quality_control',
      });
      break;
    }

    case 'decision_making':
    case 'strategy':
    case 'business_operations':
    case 'memory_continuity': {
      steps.push({
        title: 'Recall stored working context',
        rationale: 'Continuity: previous decisions and preferences inform the recommendation.',
        skillId: 'manager-orchestration',
        toolName: 'recall_memory',
        input: { scope: 'working' },
        stage: 'execute',
      });
      if (intent.primary === 'business_operations') {
        steps.push({
          title: 'Build the business report',
          rationale: 'Operational decisions need current recorded figures.',
          skillId: 'business-reporting',
          toolName: 'build_business_report',
          input: { title: topic.slice(0, 200), period: '30d' },
          stage: 'execute',
        });
      }
      steps.push({
        title: 'Create the decision memo',
        rationale: 'Separates fact, interpretation and recommendation (CEO spec §8).',
        skillId: 'manager-orchestration',
        toolName: 'create_decision_memo',
        input: {
          title: topic.slice(0, 200),
          decision: request,
          facts: [],
          interpretations: [],
          recommendations: [],
          risks: ['No verified evidence recorded yet — treat all options as provisional.'],
        },
        stage: 'execute',
      });
      break;
    }

    case 'general_orchestration':
    default: {
      steps.push({
        title: 'Recall stored working context',
        rationale: 'Provides continuity for an open-ended request.',
        skillId: 'manager-orchestration',
        toolName: 'recall_memory',
        input: { scope: 'working' },
        stage: 'execute',
      });
      break;
    }
  }

  // Medical safety gate: any request touching dental/medical subject matter is
  // screened before delivery, whatever its business work type (CEO spec §8).
  if (intent.medicalDomain && !steps.some((step) => step.toolName === 'run_medical_safety_check')) {
    steps.push({
      title: 'Screen the output for medical safety',
      rationale: 'Dental/medical output must not diagnose or prescribe and requires professional review.',
      skillId: 'dental-research',
      toolName: 'run_medical_safety_check',
      input: { text: request },
      stage: 'verify',
    });
  }

  // Universal quality-control gate before delivery.
  steps.push({
    title: 'Run quality control on the output',
    rationale: 'Every deliverable is checked for evidence, medical safety and action honesty before delivery.',
    skillId: 'quality-control',
    toolName: 'run_quality_check',
    input: { subject: topic.slice(0, 200), content: request, medicalDomain: intent.medicalDomain },
    stage: 'quality_control',
  });

  return { steps, openQuestions };
}

/**
 * Builds the visual-studio step for a request that asks for a designed email.
 * Shared by the email and visual work types so "design a launch email" and
 * "create a premium product-launch email with a banner and three product cards"
 * both land in the same editable draft.
 */
function emailDesignStep(
  request: string,
  topic: string,
  intent: ManagerIntent,
  steps: StepDraft[],
): StepDraft {
  return {
    title: 'Build the visual email design',
    rationale:
      'The studio renders a real, editable design into responsive table-based HTML with inline CSS, a plain-text alternative and validation. It is saved as a draft — nothing is sent and no template is activated.',
    skillId: 'sales-outreach-email',
    toolName: 'create_email_design',
    input: {
      name: topic.slice(0, 120),
      category: intent.primary === 'outreach' ? 'outreach' : 'campaign',
      subject: topic.slice(0, 300),
      starterId: starterDesignFor(request),
      status: 'draft',
    },
    stage: 'execute',
    dependsOn: steps.length > 0 ? [`step-${steps.length}`] : [],
  };
}

/**
 * Detects a request for a *designed* email (the Phase 16 visual studio) rather
 * than a plain subject/body template.
 */
function wantsDesignedEmail(request: string): boolean {
  return /\b(design|designed|studio|visual|banner|hero|newsletter|campaign|html email|email design|product launch|launch email|promotional email|brand header|footer|product card|gallery|cta|drag)\b/.test(
    request.toLowerCase(),
  );
}

/** Maps the wording of a request onto one of the editable starter designs. */
function starterDesignFor(request: string): string {
  const lower = request.toLowerCase();
  if (/\b(welcome|onboard|getting started|sign ?up)\b/.test(lower)) return 'starter-welcome';
  if (/\b(newsletter|digest|weekly|monthly update)\b/.test(lower)) return 'starter-newsletter';
  if (/\b(product launch|launch|new product|release)\b/.test(lower)) return 'starter-product-launch';
  if (/\b(promo|promotion|discount|sale|offer|voucher|deal)\b/.test(lower)) return 'starter-promo';
  if (/\b(announce|announcement|notice)\b/.test(lower)) return 'starter-announcement';
  if (/\b(client update|project update|progress|deliverable|report to the client)\b/.test(lower)) {
    return 'starter-client-update';
  }
  return 'starter-newsletter';
}

/** Detects an explicit request to turn a design into a sendable template. */
function wantsPromotion(request: string): boolean {
  return /\b(promote|use it to send|activate|make it sendable|turn it into a template|make it a template)\b/.test(
    request.toLowerCase(),
  );
}

/** Detects an explicit request for an external action. */
function wantsExternalAction(request: string, action: 'publish' | 'send'): boolean {
  const lower = request.toLowerCase();
  if (action === 'publish') {
    return /\b(publish|post it|post this|put it live|go live|schedule this|schedule it)\b/.test(lower);
  }
  return /\b(send|send it|send this|dispatch)\b/.test(lower);
}

function toPlanSteps(drafts: StepDraft[]): PlanStep[] {
  const steps: PlanStep[] = [];
  let previousId: string | null = null;

  drafts.forEach((draft, index) => {
    const id = `step-${index + 1}`;
    const tool = draft.toolName && hasTool(draft.toolName) ? getTool(draft.toolName) : null;
    const action = tool?.permission.action ?? 'view';
    const approval = evaluateApproval(draft.toolName ?? 'none', tool?.risk ?? 'low', action);

    steps.push({
      id,
      title: draft.title,
      rationale: draft.rationale,
      skillId: draft.skillId,
      toolName: draft.toolName && hasTool(draft.toolName) ? draft.toolName : null,
      input: draft.input,
      requiresApproval: tool ? approval.required : false,
      risk: tool ? approval.risk : 'low',
      stage: draft.stage,
      dependsOn: draft.dependsOn ?? (previousId ? [previousId] : []),
      clarification: draft.clarification ?? null,
    });

    previousId = id;
  });

  return steps;
}

function selectedSkills(intent: ManagerIntent, steps: PlanStep[]): SkillId[] {
  const fromWorkTypes = [
    ...skillsForWorkType(intent.primary),
    ...intent.secondary.flatMap((workType) => skillsForWorkType(workType)),
    // Dental/medical subject matter always engages the dental-research skill
    // for safety controls, regardless of the business work type.
    ...(intent.medicalDomain ? skillsForWorkType('dental_research') : []),
  ].map((skill) => skill.id);

  const fromSteps = steps.map((step) => step.skillId);

  return [...new Set([...fromSteps, ...fromWorkTypes])].filter((skillId) =>
    Boolean(getSkill(skillId)),
  );
}

export function buildPlan(
  intent: ManagerIntent,
  understood: UnderstoodRequest,
): ManagerPlan {
  const { steps: drafts, openQuestions } = templates(intent, understood);
  const steps = toPlanSteps(drafts);

  return {
    goal: intent.objective,
    steps,
    skills: selectedSkills(intent, steps),
    estimatedSteps: steps.length,
    openQuestions: [...new Set(openQuestions)],
    planner: 'deterministic',
  };
}

/**
 * Optional AI refinement. Only runs when a provider key is configured; on any
 * failure the deterministic plan is kept and the task records the fallback.
 */
export async function refinePlanWithAi(
  plan: ManagerPlan,
  intent: ManagerIntent,
): Promise<{ plan: ManagerPlan; applied: boolean; note: string }> {
  const { isAiEnabled, generateStructured } = await import('@/server/ai/client');

  if (!isAiEnabled()) {
    return { plan, applied: false, note: 'AI refinement skipped: no provider key configured.' };
  }

  const result = await generateStructured<z.infer<typeof stepIndexSchema>>({
    system:
      'You are assisting the NIBREXO CEO / Manager planning stage. You may only reference the skills and tools listed. Do not add tools. Do not invent facts, statistics or sources.',
    prompt: [
      `Objective: ${intent.objective}`,
      `Primary work type: ${intent.primary}`,
      `Skills available: ${plan.skills.join(', ')}`,
      'Current plan steps:',
      ...plan.steps.map((step) => `- ${step.id} [${step.toolName ?? 'no-tool'}] ${step.title}`),
      'Return the same step ids ordered as you judge best, with a short rationale for each, plus any open questions the user must answer.',
    ].join('\n'),
    schema: stepIndexSchema,
  });

  if (!result.ok) {
    return {
      plan,
      applied: false,
      note: `AI refinement unavailable (${result.reason}): ${result.message}`,
    };
  }

  const byId = new Map(plan.steps.map((step) => [step.id, step]));
  const reordered: PlanStep[] = [];

  for (const entry of result.data.steps) {
    const step = byId.get(entry.stepId);
    if (step) {
      reordered.push({ ...step, rationale: entry.rationale || step.rationale });
      byId.delete(entry.stepId);
    }
  }
  // Steps the model omitted are preserved rather than silently dropped.
  for (const remaining of byId.values()) reordered.push(remaining);

  return {
    plan: {
      ...plan,
      steps: reordered,
      openQuestions: [...new Set([...plan.openQuestions, ...result.data.openQuestions])],
      planner: 'ai',
    },
    applied: true,
    note: `Plan refined by the AI layer (${result.model}).`,
  };
}
