/**
 * Source retrieval for the Manager.
 *
 * The required path is free and official: Wikipedia plus DuckDuckGo Instant
 * Answers. See free-search.ts.
 *
 * Brave Search (GET https://api.search.brave.com/res/v1/web/search) is a
 * metered API. It is called only when NIBREXO_ALLOW_PAID_SEARCH=1 and a server
 * key are both set. A key alone does not authorize a charge.
 */

import { serverEnv } from '@/lib/env';
import { redactSecrets } from '@/server/integrations/redact';
import { searchFreeSources, type WebSource } from './free-search';

export const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
export type { WebSource };

export type WebSearchResult =
  | { status: 'ok'; sources: WebSource[]; provider: 'free' | 'brave' | 'mixed'; note?: string }
  | { status: 'needs_configuration'; missing: string[]; message: string }
  | { status: 'error'; message: string; retryable: boolean };

export interface WebSearchClient {
  search(query: string, signal?: AbortSignal): Promise<WebSearchResult>;
}

let override: WebSearchClient | null = null;

/** Test seam. Production code leaves this unset. */
export function setWebSearchClientForTests(client: WebSearchClient | null): void {
  override = client;
}

export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
  if (override) return override.search(query, signal);

  const free = await searchFreeSources(query, signal);
  if (free.status === 'ok' && free.sources.length > 0) {
    return { status: 'ok', sources: free.sources, provider: 'free', note: free.note };
  }

  const env = serverEnv();
  if (env.allowPaidSearch && env.braveSearchApiKey) {
    const paid = await searchBrave(query, env.braveSearchApiKey, signal);
    if (paid.status === 'ok' && paid.sources.length > 0) {
      return {
        status: 'ok',
        sources: [...free.sources, ...paid.sources].slice(0, 8),
        provider: free.sources.length > 0 ? 'mixed' : 'brave',
        note: 'Brave Search ran because NIBREXO_ALLOW_PAID_SEARCH=1. That API can incur charges after its credit.',
      };
    }
    if (free.status === 'error' && paid.status !== 'ok') return paid;
  }

  if (free.status === 'error') {
    return { status: 'error', retryable: free.retryable, message: free.note };
  }
  return { status: 'ok', sources: [], provider: 'free', note: free.note };
}

async function searchBrave(query: string, key: string, signal?: AbortSignal): Promise<WebSearchResult> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set('q', query.slice(0, 400));
  url.searchParams.set('count', '5');
  url.searchParams.set('extra_snippets', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      return {
        status: 'error',
        retryable: response.status === 429 || response.status >= 500,
        message: `Brave Search returned HTTP ${response.status}. ${redactSecrets(raw).slice(0, 240)}`.trim(),
      };
    }
    const parsed = JSON.parse(raw) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string; extra_snippets?: string[] }> };
    };
    const retrievedAt = new Date().toISOString();
    const sources: WebSource[] = [];
    for (const row of parsed.web?.results ?? []) {
      const link = typeof row.url === 'string' ? row.url.trim() : '';
      if (!/^https?:\/\//i.test(link)) continue;
      const snippet = [row.description, ...(row.extra_snippets ?? [])]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ')
        .slice(0, 1200);
      sources.push({
        title: (row.title || link).slice(0, 300),
        url: link,
        snippet,
        provider: 'brave',
        retrievedAt,
      });
    }
    return {
      status: 'ok',
      sources,
      provider: 'brave',
      note: 'Brave Search results. This call was explicitly allowed and can incur charges.',
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      status: 'error',
      retryable: true,
      message: aborted
        ? 'Brave Search timed out or was cancelled. It can be retried.'
        : `Brave Search request failed: ${redactSecrets(error instanceof Error ? error.message : 'network error')}`,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
