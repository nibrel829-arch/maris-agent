import { describe, expect, it } from 'vitest';
import { buildDocx, documentXml } from '@/server/artifacts/docx';
import { createZip, crc32, readZip } from '@/server/artifacts/zip';
import { csvCell, toCsv } from '@/server/artifacts/csv';
import { buildDeliverableSpecs, escapeHtml } from '@/server/manager/deliverables';
import { parseSourcedLines } from '@/server/manager/planner';
import { sha256Hex } from '@/server/artifacts/service';
import type { PlanStep, StepResult } from '@/types/manager';

const decoder = new TextDecoder();

describe('zip container', () => {
  it('round-trips entries and verifies CRC-32', () => {
    const bytes = createZip([
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'dir/b.xml', data: new TextEncoder().encode('<x/>') },
    ]);
    const files = readZip(bytes);
    expect(decoder.decode(files.get('a.txt'))).toBe('hello');
    expect(decoder.decode(files.get('dir/b.xml'))).toBe('<x/>');
  });

  it('detects a corrupted entry', () => {
    const bytes = createZip([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
    const tampered = bytes.slice();
    tampered[30 + 'a.txt'.length] = 0x58; // change one data byte
    expect(() => readZip(tampered)).toThrow(/CRC mismatch/);
  });

  it('matches the standard CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('DOCX deliverable', () => {
  const model = {
    title: 'Research brief: dental <scheduling> & "software"',
    subtitle: 'Structured research brief',
    meta: [['Domain', 'market']] as Array<[string, string]>,
    notice: 'Some claims have no recorded source.',
    sections: [
      { heading: 'Evidence', table: { headers: ['Claim', 'Source'], rows: [['Demand is rising', 'Survey 2025']] } },
      { heading: 'Gaps', bullets: ['Pricing unverified'] },
    ],
    generatedAt: '2026-10-10T08:00:00.000Z',
  };

  it('is a valid OOXML package with the document part', () => {
    const files = readZip(buildDocx(model));
    expect([...files.keys()]).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']));
    const xml = decoder.decode(files.get('word/document.xml'));
    expect(xml).toContain('Demand is rising');
    expect(xml).toContain('Pricing unverified');
  });

  it('escapes markup and removes illegal control characters', () => {
    const xml = documentXml({ ...model, title: 'x</w:t><w:t>injected\u0001' });
    expect(xml).not.toContain('</w:t><w:t>injected');
    expect(xml).toContain('&lt;/w:t&gt;');
    expect(xml).not.toContain('\u0001');
  });

  it('is deterministic for the same content and timestamp', () => {
    expect(sha256Hex(buildDocx(model))).toBe(sha256Hex(buildDocx(model)));
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1 555')).toBe(`'+1 555`);
    expect(csvCell('safe')).toBe('safe');
  });

  it('quotes commas and newlines', () => {
    expect(toCsv(['name'], [['Clinic, Karachi\nNorth']])).toBe('name\r\n"Clinic, Karachi\nNorth"\r\n');
  });
});

describe('sourced evidence parsing', () => {
  it('keeps unsourced lines unverified and sourced lines as evidence', () => {
    const parsed = parseSourcedLines('Demand is growing | https://example.org/report\nPatients prefer online booking');
    expect(parsed[0]).toMatchObject({ claim: 'Demand is growing', source: 'https://example.org/report', grade: 'EVIDENCE' });
    expect(parsed[1]).toMatchObject({ claim: 'Patients prefer online booking', source: null, grade: 'INTERPRETATION' });
  });
});

describe('deliverable specs are built only from real output', () => {
  const step = (id: string, toolName: string): PlanStep => ({
    id,
    title: `Step ${id}`,
    rationale: '',
    skillId: 'content-marketing',
    toolName,
    input: {},
    requiresApproval: false,
    risk: 'low',
    stage: 'execute',
    dependsOn: [],
    clarification: null,
  });
  const ok = (stepId: string, toolName: string, output: unknown): StepResult => ({
    stepId,
    status: 'succeeded',
    toolName,
    output,
    issues: [],
    approval: null,
    startedAt: '2026-10-10T00:00:00.000Z',
    finishedAt: '2026-10-10T00:00:01.000Z',
    durationMs: 1,
  });
  const generatedAt = '2026-10-10T08:00:00.000Z';

  it('produces no deliverable for an empty research brief', () => {
    const specs = buildDeliverableSpecs({
      steps: [step('step-1', 'create_research_brief')],
      results: [ok('step-1', 'create_research_brief', { brief: { topic: 'X', evidence: [], gaps: ['No evidence'] } })],
      request: 'Research X',
      generatedAt,
    });
    expect(specs).toEqual([]);
  });

  it('builds a research brief DOCX from recorded evidence', () => {
    const specs = buildDeliverableSpecs({
      steps: [step('step-1', 'create_research_brief'), step('step-2', 'add_research_evidence')],
      results: [
        ok('step-1', 'create_research_brief', { brief: { id: 'b1', topic: 'Dental software', evidence: [] } }),
        ok('step-2', 'add_research_evidence', {
          brief: {
            id: 'b1',
            topic: 'Dental software',
            domain: 'market',
            question: 'Is there demand?',
            evidence: [{ claim: 'Clinics want online booking', source: 'Survey', grade: 'EVIDENCE', confidence: 0.6 }],
            gaps: [],
            recommendations: [],
            structure: ['Question'],
          },
        }),
      ],
      request: 'Research dental software',
      generatedAt,
    });
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ kind: 'research_brief', format: 'docx', stepId: 'step-2' });
    const body = specs[0]?.body;
    expect(body?.type).toBe('docx');
    if (body?.type === 'docx') {
      expect(JSON.stringify(body.document)).toContain('Clinics want online booking');
    }
  });

  it('escapes plain-text request content placed into a draft email', () => {
    const specs = buildDeliverableSpecs({
      steps: [step('step-1', 'prepare_email')],
      results: [ok('step-1', 'prepare_email', { emailLog: { subject: 'Hi', body: '<script>alert(1)</script>\nSecond line' } })],
      request: 'x',
      generatedAt,
    });
    const body = specs[0]?.body;
    expect(body?.type).toBe('html');
    if (body?.type === 'html') {
      expect(body.html).not.toContain('<script>');
      expect(body.html).toContain('&lt;script&gt;');
      expect(body.html).toContain('<br>Second line');
    }
  });

  it('escapeHtml neutralises the five HTML metacharacters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
