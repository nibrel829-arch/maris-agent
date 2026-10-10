/**
 * DOCX writer for Manager deliverables. Produces a WordprocessingML package
 * with title, metadata, headings, paragraphs, bullet-style lists and tables.
 * Content is escaped and control characters are removed, so user-supplied
 * text can never break the XML or inject markup.
 */
import { createZip } from './zip';

export interface DocSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: string[][] };
}

export interface DocumentModel {
  title: string;
  subtitle?: string;
  meta: Array<[string, string]>;
  /** Shown above the sections, e.g. "Draft — review before use". */
  notice?: string;
  sections: DocSection[];
  generatedAt: string;
}

const ILLEGAL_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

export function xmlText(value: string): string {
  return value
    .replace(ILLEGAL_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function run(text: string, options: { bold?: boolean; size?: number; color?: string } = {}): string {
  const props = [
    options.bold ? '<w:b/>' : '',
    options.color ? `<w:color w:val="${options.color}"/>` : '',
    options.size ? `<w:sz w:val="${options.size}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
}

function paragraph(text: string, options: Parameters<typeof run>[1] & { indent?: boolean; spacingAfter?: number } = {}): string {
  const ppr = [
    options.indent ? '<w:ind w:left="360" w:hanging="360"/>' : '',
    `<w:spacing w:after="${options.spacingAfter ?? 120}"/>`,
  ].join('');
  return `<w:p><w:pPr>${ppr}</w:pPr>${run(text, options)}</w:p>`;
}

function table(headers: string[], rows: string[][]): string {
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('');
  const cell = (text: string, bold: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:pPr><w:spacing w:after="40"/></w:pPr>${run(text, { bold, size: 18 })}</w:p></w:tc>`;
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((header) => cell(header, true)).join('')}</w:tr>`;
  const body = rows
    .map((row) => `<w:tr>${headers.map((_, index) => cell(row[index] ?? '', false)).join('')}</w:tr>`)
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${head}${body}</w:tbl>`;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function documentXml(model: DocumentModel): string {
  const parts: string[] = [];
  parts.push(paragraph(model.title, { bold: true, size: 40, color: '1F2937', spacingAfter: 60 }));
  if (model.subtitle) parts.push(paragraph(model.subtitle, { size: 24, color: '4B5563' }));
  if (model.notice) parts.push(paragraph(model.notice, { bold: true, size: 20, color: '92400E' }));
  for (const [label, value] of model.meta) {
    parts.push(paragraph(`${label}: ${value}`, { size: 20, color: '374151', spacingAfter: 40 }));
  }
  parts.push(paragraph(`Generated ${model.generatedAt} by the NIBREXO Manager from recorded task output.`, { size: 18, color: '6B7280', spacingAfter: 240 }));

  for (const section of model.sections) {
    parts.push(paragraph(section.heading, { bold: true, size: 28, color: '111827', spacingAfter: 120 }));
    for (const text of section.paragraphs ?? []) {
      for (const line of splitLines(text)) parts.push(paragraph(line || ' ', { size: 22 }));
    }
    for (const bullet of section.bullets ?? []) {
      parts.push(paragraph(`•  ${bullet}`, { size: 22, indent: true, spacingAfter: 60 }));
    }
    if (section.table && section.table.headers.length > 0) {
      parts.push(table(section.table.headers, section.table.rows));
      parts.push(paragraph('', { spacingAfter: 120 }));
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>` +
    '</w:document>'
  );
}

export function buildDocx(model: DocumentModel): Uint8Array {
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';
  const core =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlText(model.title)}</dc:title>` +
    '<dc:creator>NIBREXO Manager</dc:creator>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${xmlText(model.generatedAt)}</dcterms:created>` +
    '</cp:coreProperties>';

  const encoder = new TextEncoder();
  return createZip(
    [
      { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
      { name: '_rels/.rels', data: encoder.encode(rootRels) },
      { name: 'docProps/core.xml', data: encoder.encode(core) },
      { name: 'word/document.xml', data: encoder.encode(documentXml(model)) },
    ],
    new Date(model.generatedAt),
  );
}
