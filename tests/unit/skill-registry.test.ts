import { describe, expect, it } from 'vitest';
import {
  SKILL_IDS,
  getSkill,
  listSkills,
  skillsForWorkType,
  validateRegistry,
} from '@/server/manager/skill-registry';
import { toolNames } from '@/server/manager/tool-registry';

describe('Skill registry (CEO spec §3)', () => {
  it('registers exactly the eleven documented skills', () => {
    expect(SKILL_IDS).toHaveLength(11);
    expect([...SKILL_IDS].sort()).toEqual(
      [
        'business-reporting',
        'content-marketing',
        'dental-research',
        'lead-generation',
        'manager-orchestration',
        'product-development',
        'quality-control',
        'research-intelligence',
        'sales-outreach-email',
        'social-community',
        'visual-content',
      ].sort(),
    );
  });

  it('references only registered tools', () => {
    expect(validateRegistry(toolNames())).toEqual([]);
  });

  it('gives every skill at least one work type, tool and output', () => {
    for (const skill of listSkills()) {
      expect(skill.workTypes.length).toBeGreaterThan(0);
      expect(skill.tools.length).toBeGreaterThan(0);
      expect(skill.outputs.length).toBeGreaterThan(0);
    }
  });

  it('resolves dental work to the dental research skill', () => {
    const skills = skillsForWorkType('dental_research').map((skill) => skill.id);
    expect(skills).toContain('dental-research');
  });

  it('declares the true maximum risk for external-capable skills', () => {
    expect(getSkill('sales-outreach-email')?.maxRisk).toBe('high');
    expect(getSkill('social-community')?.maxRisk).toBe('high');
    expect(getSkill('research-intelligence')?.maxRisk).toBe('low');
  });

  it('keeps the Manager orchestration skill as a capability, not a separate CEO', () => {
    const manager = getSkill('manager-orchestration');
    expect(manager?.description).toMatch(/central coordination capability/i);
  });
});
