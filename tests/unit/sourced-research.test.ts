import { afterEach, describe, expect, it, vi } from 'vitest';
import { setWebSearchClientForTests } from '@/server/integrations/research/web-search';
import { conductSourcedResearch } from '@/server/integrations/research/sourced-research';

afterEach(() => {
  setWebSearchClientForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sourced research', () => {
  it('blocks when web search is not configured and does not invent sources', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    const result = await conductSourcedResearch({ question: 'Market size for dental scheduling software' });
    expect(result.status).toBe('needs_configuration');
    if (result.status !== 'needs_configuration') return;
    expect(result.sources).toEqual([]);
    expect(result.missing).toContain('BRAVE_SEARCH_API_KEY');
    expect(result.message).toMatch(/not configured|No sources/i);
  });

  it('stores only retrieved URLs and drops a model claim that cites a different source', async () => {
    setWebSearchClientForTests({
      async search() {
        return {
          status: 'ok',
          provider: 'brave',
          sources: [
            {
              title: 'Clinic scheduling notes',
              url: 'https://example.com/scheduling',
              snippet: 'Independent clinics still book recalls by phone.',
              provider: 'brave',
              retrievedAt: '2026-10-08T00:00:00.000Z',
            },
          ],
        };
      },
    });
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-deepseek-test-key');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: 'deepseek-flash',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  findings: [
                    {
                      claim: 'Independent clinics still book recalls by phone.',
                      sourceUrl: 'https://example.com/scheduling',
                    },
                    {
                      claim: 'The market is worth 9 billion dollars.',
                      sourceUrl: 'https://invented.example/report',
                    },
                  ],
                }),
              },
            },
          ],
        }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await conductSourcedResearch({ question: 'How do clinics book recalls?' });
    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') return;
    expect(result.findings.every((finding) => finding.source === 'https://example.com/scheduling')).toBe(true);
    expect(result.findings.some((finding) => /9 billion/i.test(finding.claim))).toBe(false);
    expect(result.findings.every((finding) => finding.grade !== 'FACT')).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls.at(0) as unknown as [string, RequestInit] | undefined;
    expect(call?.[0]).toBe('https://api.deepseek.com/chat/completions');
    const headers = (call?.[1].headers ?? {}) as Record<string, string>;
    expect(String(headers.Authorization)).toContain('Bearer ');
    expect(JSON.stringify(result)).not.toContain('sk-deepseek-test-key');
  });

  it('does not call DeepSeek to invent an answer when search has no key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-should-not-be-used');
    const result = await conductSourcedResearch({ question: 'Latest competitor pricing' });
    expect(result.status).toBe('needs_configuration');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
