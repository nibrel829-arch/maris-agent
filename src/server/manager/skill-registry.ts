/**
 * Skill Registry (CEO spec §3).
 *
 * Skills are modular capabilities available to the ONE central Manager. They
 * are not independent agents: nothing in this registry can self-initiate work,
 * grant itself permission, or bypass the Manager's planning and approval flow.
 *
 * Definitions live in JSON (`src/skills/<id>/skill.json`) and are validated at
 * module load so a malformed capability fails fast rather than at run time.
 */

import { z } from 'zod';
import type { DeliverableKind, SkillDefinition, SkillId, WorkType } from '@/types/manager';

import managerOrchestration from '@/skills/manager-orchestration/skill.json';
import researchIntelligence from '@/skills/research-intelligence/skill.json';
import dentalResearch from '@/skills/dental-research/skill.json';
import productDevelopment from '@/skills/product-development/skill.json';
import visualContent from '@/skills/visual-content/skill.json';
import contentMarketing from '@/skills/content-marketing/skill.json';
import leadGeneration from '@/skills/lead-generation/skill.json';
import salesOutreachEmail from '@/skills/sales-outreach-email/skill.json';
import socialCommunity from '@/skills/social-community/skill.json';
import qualityControl from '@/skills/quality-control/skill.json';
import businessReporting from '@/skills/business-reporting/skill.json';

const skillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  workTypes: z.array(z.string().min(1)).min(1),
  modules: z.array(z.string().min(1)).min(1),
  tools: z.array(z.string().min(1)).min(1),
  knowledge: z.array(z.string()),
  outputs: z.array(z.string().min(1)).min(1),
  maxRisk: z.enum(['low', 'medium', 'high']),
  version: z.string().min(1),
});

const RAW_DEFINITIONS = [
  managerOrchestration,
  researchIntelligence,
  dentalResearch,
  productDevelopment,
  visualContent,
  contentMarketing,
  leadGeneration,
  salesOutreachEmail,
  socialCommunity,
  qualityControl,
  businessReporting,
];

function load(): Map<SkillId, SkillDefinition> {
  const registry = new Map<SkillId, SkillDefinition>();
  for (const raw of RAW_DEFINITIONS) {
    const parsed = skillSchema.parse(raw);
    registry.set(parsed.id as SkillId, parsed as unknown as SkillDefinition);
  }
  return registry;
}

const REGISTRY = load();

export const SKILL_IDS: readonly SkillId[] = [...REGISTRY.keys()];

export function listSkills(): SkillDefinition[] {
  return [...REGISTRY.values()];
}

export function getSkill(id: SkillId): SkillDefinition | undefined {
  return REGISTRY.get(id);
}

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && REGISTRY.has(value as SkillId);
}

/** Skills able to serve a given work type, most specific first. */
export function skillsForWorkType(workType: WorkType): SkillDefinition[] {
  return listSkills().filter((skill) => (skill.workTypes as string[]).includes(workType));
}

export function skillOwnsTool(skillId: SkillId, toolName: string): boolean {
  return getSkill(skillId)?.tools.includes(toolName) ?? false;
}

/** Skills that can produce a given deliverable. */
export function skillsForDeliverable(deliverable: DeliverableKind): SkillDefinition[] {
  return listSkills().filter((skill) => (skill.outputs as string[]).includes(deliverable));
}

/**
 * Validation used by tests and by the `/api/manager/skills` route: every skill
 * must reference only registered tools and known knowledge files.
 */
export function validateRegistry(registeredTools: readonly string[]): string[] {
  const problems: string[] = [];
  for (const skill of listSkills()) {
    for (const tool of skill.tools) {
      if (!registeredTools.includes(tool)) {
        problems.push(`Skill "${skill.id}" references unregistered tool "${tool}".`);
      }
    }
  }
  return problems;
}
