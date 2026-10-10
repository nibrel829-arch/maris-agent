/**
 * Bounded, read-only previews of stored deliverables (Phase 18).
 *
 * Previews are derived from the stored bytes only, so they show exactly what
 * the download contains. They are capped in rows and paragraphs so a large
 * deliverable cannot flood the browser. Pure functions: no I/O.
 */
import { readZip, ZipFormatError } from './zip';

export const PREVIEW_MAX_ROWS = 25;
export const PREVIEW_MAX_PARAGRAPHS = 80;

export type ArtifactPreview =
  | { kind: 'table'; headers: string[]; rows: string[][]; totalRows: number }
  | { kind: 'text'; paragraphs: string[]; totalParagraphs: number }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'error'; message: string };

/** RFC 4180 parser: quoted fields, doubled quotes, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ''));
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return XML_ENTITIES[entity] ?? '';
  });
}

/** Paragraph text from a WordprocessingML document body. */
export function docxParagraphs(documentXml: string): string[] {
  return documentXml
    .split('</w:p>')
    .map((paragraph) => {
      const parts: string[] = [];
      const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(paragraph)) !== null) parts.push(decodeXmlText(match[1] ?? ''));
      return parts.join('').trim();
    })
    .filter((line) => line.length > 0);
}

export function previewArtifact(input: { format: string; bytes: Uint8Array }): ArtifactPreview {
  try {
    if (input.format === 'csv') {
      const text = new TextDecoder('utf-8').decode(input.bytes);
      const all = parseCsv(text);
      if (all.length === 0) return { kind: 'table', headers: [], rows: [], totalRows: 0 };
      const [headers, ...body] = all;
      return {
        kind: 'table',
        headers: headers ?? [],
        rows: body.slice(0, PREVIEW_MAX_ROWS),
        totalRows: body.length,
      };
    }
    if (input.format === 'docx') {
      const files = readZip(input.bytes);
      const xml = files.get('word/document.xml');
      if (!xml) return { kind: 'error', message: 'The document body is missing from the file.' };
      const paragraphs = docxParagraphs(new TextDecoder('utf-8').decode(xml));
      return {
        kind: 'text',
        paragraphs: paragraphs.slice(0, PREVIEW_MAX_PARAGRAPHS),
        totalParagraphs: paragraphs.length,
      };
    }
    return { kind: 'unsupported', reason: `No preview is available for ${input.format.toUpperCase()} files. Download the file to open it.` };
  } catch (error) {
    const message = error instanceof ZipFormatError ? 'The stored file is not a valid document.' : 'The preview could not be generated.';
    return { kind: 'error', message };
  }
}
