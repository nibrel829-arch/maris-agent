/**
 * Source-backed web search.
 *
 * Official Brave Search Web Search API, verified 2026-10-08:
 *   GET https://api.search.brave.com/res/v1/web/search
 *   Header: X-Subscription-Token: $BRAVE_SEARCH_API_KEY
 *   Docs: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 *
 * When the key is absent this module returns needs_configuration. It never
 * fabricates titles, URLs or snippets.
 */

import { serverEnv } from '@/lib/env';
import { redactSecrets } from '@/server/integrations/redact';

export const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

export interface WebSource {
  title: string;
  url: string;
  snippet: string;
  provider: 'brave';
  retrievedAt: string;
}

export type WebSearchResult =
  | { status: 'ok'; sources: WebSource[]; provider: 'brave' }
  | { status: 'needs_configuration'; missing: string[]; message: string }
  | { status: 'error'; message: string; retryable: boolean };

export interface WebSearchClient {
  search(query: string, signal?: AbortSignal): Promise<WebSearchResult>;
}

const httpSearch: WebSearchClient = {
  async search(query, signal) {
    const key = serverEnv().braveSearchApiKey;
    if (!key) {
      return {
        status: 'needs_configuration',
        missing: ['BRAVE_SEARCH_API_KEY'],
        message:
          'Source-backed web research needs BRAVE_SEARCH_API_KEY on the server (Brave Search API, GET https://api.search.brave.com/res/v1/web/search). No sources were retrieved and none were invented.',
      };
    }

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
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': key,
        },
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
      return { status: 'ok', sources, provider: 'brave' };
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
  },
};

let override: WebSearchClient | null = null;

/** Test seam. Production code leaves this unset. */
export function setWebSearchClientForTests(client: WebSearchClient | null): void {
  override = client;
}

export function searchWeb(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
  return (override ?? httpSearch).search(query, signal);
}
