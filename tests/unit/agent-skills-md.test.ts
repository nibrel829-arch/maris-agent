/**
 * Regression tests for the Agent Skills specification-compliant skill
 * directories under `skills/`. Phase 02 requirement: each of the 11 skills
 * must have a SKILL.md with valid frontmatter whose `name` matches the
 * directory. The runtime JSON under `src/skills/` is kept in parallel.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SKILL_IDS } from '@/server/manager/skill-registry';

const REPO_ROOT = join(__dirname, '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');

interface Frontmatter {
  data: Record<string, string | string[]>;
  body: string;
}

/**
 * Minimal YAML frontmatter parser for SKILL.md files.
 * Handles: inline scalars, list items, and folded block scalars (`key: >-`).
 * Not a general YAML implementation — just enough to validate our files.
 */
function parseFrontmatter(raw: string): Frontmatter {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!fmMatch) {
    return { data: {}, body: raw };
  }

  const fmBlock: string = fmMatch[1] ?? '';
  const body: string = fmMatch[2] ?? '';

  const data: Record<string, string | string[]> = {};
  const lines = fmBlock.split(/\r?\n/);

  let currentKey = '';
  let currentList: string[] = [];
  let foldedLines: string[] = [];
  let mode: 'scalar' | 'list' | 'folded' = 'scalar';

  function flushFolded(): void {
    if (mode === 'folded' && currentKey) {
      data[currentKey] = foldedLines.join(' ').trim();
      foldedLines = [];
    }
  }

  for (const line of lines) {
    const isIndented = /^\s+\S/.test(line);
    const isBlank = !line.trim();

    if (mode === 'folded' && isIndented && !isBlank) {
      foldedLines.push(line.trim());
      continue;
    }
    if (mode === 'folded' && (!isIndented || isBlank)) {
      flushFolded();
      mode = 'scalar';
      if (isBlank) continue;
    }

    const listItemMatch = /^\s+-\s+(.+)$/.exec(line);
    if (listItemMatch && mode === 'list') {
      const item = listItemMatch[1];
      if (item) currentList.push(item.trim());
      continue;
    }

    const kvMatch = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line);
    if (kvMatch) {
      flushFolded();
      const key = kvMatch[1] ?? '';
      const value = (kvMatch[2] ?? '').trim();
      currentKey = key;

      if (/^>-?$/.test(value)) {
        mode = 'folded';
        foldedLines = [];
      } else if (value === '') {
        mode = 'list';
        currentList = [];
        data[key] = currentList;
      } else {
        mode = 'scalar';
        data[key] = value;
      }
      continue;
    }
  }

  flushFolded();

  return { data, body };
}

describe('Agent Skills directories (Phase 02)', () => {
  it('contains an exactly matching directory for every registered skill', () => {
    const dirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    expect(dirs).toEqual([...SKILL_IDS].sort());
  });

  it('every skill directory contains a non-empty SKILL.md', () => {
    for (const id of SKILL_IDS) {
      const path = join(SKILLS_DIR, id, 'SKILL.md');
      expect(existsSync(path), `Missing SKILL.md for ${id}`).toBe(true);
      const content = readFileSync(path, 'utf8');
      expect(content.length).toBeGreaterThan(100);
      expect(content, `SKILL.md for ${id} should start with YAML frontmatter`).toMatch(/^---\n/);
    }
  });

  it('SKILL.md frontmatter name matches the directory name', () => {
    for (const id of SKILL_IDS) {
      const content = readFileSync(join(SKILLS_DIR, id, 'SKILL.md'), 'utf8');
      const { data } = parseFrontmatter(content);
      expect(data.name, `${id}/SKILL.md name field mismatch`).toBe(id);
    }
  });

  it('SKILL.md frontmatter has a non-empty description and body has "When to use"', () => {
    for (const id of SKILL_IDS) {
      const content = readFileSync(join(SKILLS_DIR, id, 'SKILL.md'), 'utf8');
      const { data, body } = parseFrontmatter(content);
      const description = typeof data.description === 'string' ? data.description : '';
      expect(description.length, `${id} description is empty`).toBeGreaterThan(20);
      expect(body, `${id} body is missing a "When to use" section`).toMatch(/##\s+When to use/i);
    }
  });

  it('the Manager orchestration SKILL.md states it is the Manager, not a separate agent', () => {
    const content = readFileSync(
      join(SKILLS_DIR, 'manager-orchestration', 'SKILL.md'),
      'utf8',
    );
    expect(content).toMatch(/not a separate agent|is the Manager itself|not .* autonomous agents?/i);
  });
});
