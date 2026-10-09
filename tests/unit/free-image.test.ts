import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectImageBytes } from '@/server/integrations/media/image-bytes';
import { generateFreeImage, isPaidImageHost, setFreeImageGeneratorForTests } from '@/server/integrations/media/free-image';

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

afterEach(() => {
  setFreeImageGeneratorForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('nibrexo image engine client', () => {
  it('rejects prompt text and non-image bytes', () => {
    expect(inspectImageBytes(new TextEncoder().encode('a prompt is not an image')).ok).toBe(false);
    expect(inspectImageBytes(new Uint8Array([0, 1, 2, 3])).ok).toBe(false);
    expect(inspectImageBytes(PNG).ok).toBe(true);
  });

  it('does not call an external image API when the engine URL is unset', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-paid-should-not-be-used');
    vi.stubEnv('NIBREXO_IMAGE_PROVIDER', 'cloudflare');
    vi.stubEnv('NIBREXO_IMAGE_ENGINE_URL', '');
    vi.stubEnv('NIBREXO_LOCAL_IMAGE_URL', '');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token-secret');
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'abc123');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateFreeImage({ prompt: 'A red square' });
    expect(result.status).toBe('needs_configuration');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('cf-token-secret');
    expect(JSON.stringify(result)).not.toContain('sk-paid-should-not-be-used');
    expect(isPaidImageHost('api.openai.com')).toBe(true);
    expect(isPaidImageHost('api.cloudflare.com')).toBe(true);
    expect(isPaidImageHost('gen.pollinations.ai')).toBe(true);
    expect(isPaidImageHost('api.bfl.ai')).toBe(true);
  });

  it('refuses an external host without sending the prompt', async () => {
    vi.stubEnv('NIBREXO_IMAGE_ENGINE_URL', 'https://api.openai.com/v1/images/generations');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateFreeImage({ prompt: 'A red square' });
    expect(result.status).toBe('needs_configuration');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts verified bytes from the Nibrexo engine and ignores a non-image body', async () => {
    vi.stubEnv('NIBREXO_IMAGE_ENGINE_URL', 'http://127.0.0.1:8788');
    const fetchMock = vi.fn(async (url: URL | string) => {
      const href = String(url);
      if (href.endsWith('/health')) {
        return jsonResponse({ engine: 'nibrexo-image-engine', canGenerate: true, missing: [] });
      }
      if (href.endsWith('/v1/jobs')) {
        return jsonResponse({ id: 'job-1', status: 'completed', model: 'sd-legacy/stable-diffusion-v1-5', steps: 4, ignored: [] });
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
        arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateFreeImage({ prompt: 'A red square', negativePrompt: 'blur', width: 1024, height: 1024 });
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.provider).toBe('nibrexo');
    expect(result.bytes.byteLength).toBe(PNG.byteLength);
    expect(fetchMock.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('openai.com');
    expect(fetchMock.mock.calls.map((call) => String(call[0])).join(' ')).not.toContain('cloudflare.com');
  });

  it('does not treat a text response as a generated image', async () => {
    vi.stubEnv('NIBREXO_IMAGE_ENGINE_URL', 'http://127.0.0.1:8788');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const href = String(url);
        if (href.endsWith('/health')) return jsonResponse({ engine: 'nibrexo-image-engine', canGenerate: true });
        if (href.endsWith('/v1/jobs')) return jsonResponse({ id: 'job-2', status: 'completed' });
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new TextEncoder().encode('not an image').buffer,
        };
      }),
    );
    const result = await generateFreeImage({ prompt: 'A red square' });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.message).toMatch(/PNG|JPEG|WebP|empty|truncated/i);
  });

  it('reports a still-running job instead of inventing a file', async () => {
    vi.stubEnv('NIBREXO_IMAGE_ENGINE_URL', 'http://127.0.0.1:8788');
    vi.stubEnv('NIBREXO_IMAGE_ENGINE_TIMEOUT_MS', '60');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        const href = String(url);
        if (href.endsWith('/health')) return jsonResponse({ engine: 'nibrexo-image-engine', canGenerate: true });
        return jsonResponse({
          id: 'job-3',
          status: 'running',
          progress: { stage: 'denoising', step: 1, total: 20, message: 'Denoising step 1 of 20. The file is not saved yet.' },
        });
      }),
    );
    const result = await generateFreeImage({ prompt: 'A red square' });
    expect(result.status).toBe('running');
    if (result.status === 'running') expect(result.jobId).toBe('job-3');
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  };
}
