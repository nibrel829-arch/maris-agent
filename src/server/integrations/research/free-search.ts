/**
 * Free, official source retrieval. No API key and no billing.
 *
 * Wikipedia Action API (https://www.mediawiki.org/wiki/API:Search):
 *   GET https://en.wikipedia.org/w/api.php?action=query&generator=search
 * DuckDuckGo Instant Answer API is official and keyless, but it is not a web
 * index. It is used only when it returns an AbstractURL. Unofficial scrapers
 * are not used.
 *
 * Brave Search is not called here. As of 2026 it is a metered API.
 */

import { redactSecrets } from '@/server/integrations/redact';

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
  provider: 'wikipedia' | 'duckduckgo_instant' | 'brave';
  retrievedAt: string;
}

const USER_AGENT = 'NibrexoOS/0.1 (https://github.com/nibrel829-arch/maris-agent; free-research)';

export interface FreeSearchResult {
  status: 'ok' | 'error';
  sources: WebSource[];
  note: string;
  retryable: boolean;
}

export async function searchFreeSources(query: string, signal?: AbortSignal): Promise<FreeSearchResult> {
  const [wiki, instant] = await Promise.all([
    searchWikipedia(query, signal),
    searchDuckDuckGoInstant(query, signal),
  ]);
  const sources = dedupe([...wiki.sources, ...instant.sources]).slice(0, 5);
  if (sources.length > 0) {
    return {
      status: 'ok',
      sources,
      retryable: false,
      note: 'Sources came from the Wikipedia Action API and, when present, the DuckDuckGo Instant Answer API. Neither is a general web index. Brave Search was not called.',
    };
  }
  if (wiki.error && instant.error) {
    return {
      status: 'error',
      sources: [],
      retryable: true,
      note: `Free source retrieval failed. Wikipedia: ${wiki.error} DuckDuckGo Instant Answer: ${instant.error} No sources were invented and no paid search API was called.`,
    };
  }
  return {
    status: 'ok',
    sources: [],
    retryable: false,
    note: 'The free Wikipedia and DuckDuckGo Instant Answer lookups returned no usable URL for this question. No general web index is configured, and no sources were invented.',
  };
}

async function searchWikipedia(
  query: string,
  signal?: AbortSignal,
): Promise<{ sources: WebSource[]; error: string | null }> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query.slice(0, 300));
  url.searchParams.set('gsrlimit', '3');
  url.searchParams.set('gsrnamespace', '0');
  url.searchParams.set('prop', 'extracts');
  url.searchParams.set('exintro', '1');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('exchars', '400');
  url.searchParams.set('format', 'json');
  url.searchParams.set('utf8', '1');

  const fetched = await getJson(url, signal);
  if (!fetched.ok) return { sources: [], error: fetched.error };
  const pages = (fetched.data as { query?: { pages?: Record<string, WikiPage> } }).query?.pages ?? {};
  const retrievedAt = new Date().toISOString();
  const sources: WebSource[] = [];
  for (const page of Object.values(pages)) {
    if (!page.title || page.missing) continue;
    const snippet = strip(page.extract ?? '').slice(0, 500);
    if (!snippet) continue;
    sources.push({
      title: page.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      snippet,
      provider: 'wikipedia',
      retrievedAt,
    });
  }
  return { sources, error: null };
}

async function searchDuckDuckGoInstant(
  query: string,
  signal?: AbortSignal,
): Promise<{ sources: WebSource[]; error: string | null }> {
  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', query.slice(0, 300));
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');
  const fetched = await getJson(url, signal);
  if (!fetched.ok) return { sources: [], error: fetched.error };
  const data = fetched.data as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
  };
  const abstractUrl = data.AbstractURL?.trim() ?? '';
  const snippet = strip(data.AbstractText ?? '').slice(0, 500);
  if (!abstractUrl.startsWith('https://') || !snippet) return { sources: [], error: null };
  return {
    sources: [
      {
        title: data.Heading?.trim() || 'DuckDuckGo Instant Answer',
        url: abstractUrl,
        snippet,
        provider: 'duckduckgo_instant',
        retrievedAt: new Date().toISOString(),
      },
    ],
    error: null,
  };
}

interface WikiPage {
  title?: string;
  extract?: string;
  missing?: boolean;
}

async function getJson(
  url: URL,
  signal?: AbortSignal,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} from ${url.hostname}. ${redactSecrets(raw).slice(0, 160)}` };
    }
    return { ok: true, data: JSON.parse(raw) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: redactSecrets(error instanceof Error ? error.message : 'network error'),
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function dedupe(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function strip(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
