/**
 * Source-backed research orchestration.
 *
 * Order: retrieve web sources → optionally ask DeepSeek to phrase claims that
 * already appear in those sources → drop anything that is not tied to a
 * retrieved URL. DeepSeek is never asked to "know" the answer.
 */

import type { ResearchEvidence } from '@/types/domain';
import { deepseekChat } from './deepseek';
import { searchWeb, type WebSource } from './web-search';

export interface SourcedFinding extends ResearchEvidence {
  sourceUrl: string;
}

export type SourcedResearchResult =
  | {
      status: 'recorded';
      sources: WebSource[];
      findings: SourcedFinding[];
      model: string | null;
      note: string;
    }
  | {
      status: 'needs_configuration';
      missing: string[];
      message: string;
      sources: WebSource[];
    }
  | {
      status: 'error';
      message: string;
      retryable: boolean;
      sources: WebSource[];
    };

function claimSupportedBySnippet(claim: string, snippet: string): boolean {
  const haystack = snippet.toLowerCase();
  const tokens = claim
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 4);
  if (tokens.length === 0) return claim.length > 0 && haystack.includes(claim.toLowerCase().slice(0, 40));
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  return hits >= Math.min(3, Math.ceil(tokens.length * 0.4));
}

function findingsFromSources(sources: readonly WebSource[]): SourcedFinding[] {
  return sources
    .filter((source) => source.snippet.trim().length > 0)
    .map((source) => ({
      claim: source.snippet.slice(0, 500),
      source: source.url,
      sourceUrl: source.url,
      grade: 'EVIDENCE' as const,
      confidence: 0.55,
      uncertainty: 'Search snippet only. The page was not fully re-read, so this is evidence, not a verified FACT.',
    }));
}

function parseModelFindings(content: string, sources: readonly WebSource[]): SourcedFinding[] {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: { findings?: Array<{ claim?: string; sourceUrl?: string }> };
  try {
    parsed = JSON.parse(content.slice(start, end + 1)) as typeof parsed;
  } catch {
    return [];
  }
  const byUrl = new Map(sources.map((source) => [source.url, source]));
  const kept: SourcedFinding[] = [];
  for (const row of parsed.findings ?? []) {
    if (typeof row.claim !== 'string' || typeof row.sourceUrl !== 'string') continue;
    const source = byUrl.get(row.sourceUrl.trim());
    if (!source) continue;
    if (!claimSupportedBySnippet(row.claim, source.snippet)) continue;
    kept.push({
      claim: row.claim.slice(0, 500),
      source: source.url,
      sourceUrl: source.url,
      grade: 'EVIDENCE',
      confidence: 0.6,
      uncertainty: 'Phrased from a retrieved snippet. Not upgraded to FACT.',
    });
  }
  return kept.slice(0, 8);
}

export async function conductSourcedResearch(input: {
  question: string;
  signal?: AbortSignal;
}): Promise<SourcedResearchResult> {
  const searched = await searchWeb(input.question, input.signal);
  if (searched.status === 'needs_configuration') {
    return {
      status: 'needs_configuration',
      missing: searched.missing,
      message: `${searched.message} DeepSeek can synthesize only after sources are retrieved; it is not a substitute for search.`,
      sources: [],
    };
  }
  if (searched.status === 'error') {
    return { status: 'error', message: searched.message, retryable: searched.retryable, sources: [] };
  }
  if (searched.sources.length === 0) {
    return {
      status: 'recorded',
      sources: [],
      findings: [],
      model: null,
      note: 'Brave Search returned no web results for this question. No findings were added.',
    };
  }

  const fallback = findingsFromSources(searched.sources);
  const synthesis = await deepseekChat({
    messages: [
      {
        role: 'system',
        content:
          'You extract claims that are already present in the supplied source snippets. Return JSON only: {"findings":[{"claim":"...","sourceUrl":"..."}]}. Every sourceUrl must be copied from the sources. Do not add statistics, companies, prices or facts that are not in a snippet. If nothing is supported, return {"findings":[]}.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: input.question,
          sources: searched.sources.map((source) => ({
            title: source.title,
            url: source.url,
            snippet: source.snippet,
          })),
        }),
      },
    ],
    signal: input.signal,
    maxTokens: 900,
  });

  if (synthesis.status === 'ok') {
    const phrased = parseModelFindings(synthesis.content, searched.sources);
    return {
      status: 'recorded',
      sources: searched.sources,
      findings: phrased.length > 0 ? phrased : fallback,
      model: synthesis.model,
      note:
        phrased.length > 0
          ? `Findings were limited to retrieved Brave Search sources and phrased by DeepSeek (${synthesis.model}). Unsourced model claims were dropped.`
          : `DeepSeek did not return snippet-backed claims. The retrieved snippets were stored as EVIDENCE instead. Model: ${synthesis.model}.`,
    };
  }

  return {
    status: 'recorded',
    sources: searched.sources,
    findings: fallback,
    model: null,
    note:
      synthesis.status === 'needs_configuration'
        ? 'Sources were retrieved from Brave Search and stored as EVIDENCE. DeepSeek is not configured, so no model synthesis was applied.'
        : `Sources were stored as EVIDENCE. DeepSeek synthesis was not used: ${synthesis.message}`,
  };
}
