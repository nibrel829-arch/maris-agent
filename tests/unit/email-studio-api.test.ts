import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidStudioInput, studioFailure } from '@/app/api/workspace/email/_shared';
import type { ActorContext } from '@/types/domain';
import type { NibrexoRepository } from '@/server/db/types';
import { createBlock, emptyDesignDocument } from '@/features/email/studio/block-defaults';
import { DEFAULT_EMAIL_BRAND_PROFILE } from '@/types/email-design';

const resolveActor = vi.fn();
const getRequestRepository = vi.fn();

vi.mock('@/server/auth/actor', () => ({ resolveActor }));
vi.mock('@/server/db', () => ({ getRequestRepository }));

const { POST: renderDraft } = await import('@/app/api/workspace/email/designs/render-draft/route');
const { GET: getDesignRoute, DELETE: deleteDesignRoute } = await import(
  '@/app/api/workspace/email/designs/[id]/route'
);
const { POST: createDesignRoute, GET: listDesignsRoute } = await import(
  '@/app/api/workspace/email/designs/route'
);
const { GET: startersRoute } = await import('@/app/api/workspace/email/starters/route');

const owner: ActorContext = {
  userId: '00000000-0000-0000-0000-0000000000a1',
  organizationId: '00000000-0000-0000-0000-000000000001',
  role: 'owner',
  email: 'owner@nibrexo.test',
  fullName: 'Test Owner',
  isDevIdentity: true,
};

function request(body: unknown, url = 'https://os.nibrexo.test/api/workspace/email/designs/render-draft') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return (await response.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
}

/** A plain-JSON design document, exactly as the browser would post it. */
const brand = DEFAULT_EMAIL_BRAND_PROFILE;
const design = (() => {
  const base = emptyDesignDocument(brand);
  const header = createBlock('header', { brand: base.brand, profile: null });
  header.props = { ...header.props, brandName: 'Nibrexo' };
  const footer = createBlock('footer', { brand: base.brand, profile: null });
  footer.props = {
    ...footer.props,
    companyName: 'Nibrexo Ltd',
    unsubscribeUrl: 'https://nibrexo.test/unsubscribe',
  };
  base.blocks = [header, footer];
  return JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
})();

describe('Email studio API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveActor.mockResolvedValue({ ok: true, data: owner });
    getRequestRepository.mockResolvedValue({
      ok: true,
      data: { emailDesigns: { list: vi.fn().mockResolvedValue([]) } } as unknown as NibrexoRepository,
    });
  });

  it('renders an unsaved document for the canvas', async () => {
    const response = await renderDraft(request({ design, subject: 'Live preview' }), {});
    expect(response.status).toBe(200);
    const payload = await read(response);
    expect(payload.ok).toBe(true);
    expect(payload.data?.subject).toBe('Live preview');
    expect(String(payload.data?.html)).toContain('<!DOCTYPE html>');
    expect(String(payload.data?.html)).toMatch(/data-email-block="[^"]+"/);
    expect(String(payload.data?.text)).toContain('Nibrexo');
  });

  it('builds signed asset URLs from the request origin', async () => {
    const withAsset = (() => {
      const base = emptyDesignDocument(brand);
      const banner = createBlock('banner', { brand: base.brand, profile: null });
      banner.props = {
        ...banner.props,
        image: { mediaId: '44444444-4444-4444-4444-444444444444', url: null, alt: 'Banner' },
      };
      base.blocks = [banner];
      return JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    })();
    const payload = await read(
      await renderDraft(request({ design: withAsset }), {}),
    );
    const html = String(payload.data?.html);
    expect(html).toContain('https://os.nibrexo.test/api/workspace/email/assets/44444444-4444-4444-4444-444444444444');
    expect(html).toContain('sig=');
  });

  it('rejects a malformed document with a validation error', async () => {
    const response = await renderDraft(request({ design: { blocks: 'nope' } }), {});
    expect(response.status).toBe(400);
    const payload = await read(response);
    expect(payload.error?.code).toBe('DESIGN_INVALID');
  });

  it('rejects an unauthenticated caller', async () => {
    resolveActor.mockResolvedValue({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required.', severity: 'error', retryable: false, errorClass: 'auth' },
    });
    const response = await renderDraft(request({ design }), {});
    expect(response.status).toBe(401);
  });

  it('lists the starter designs for the studio gallery', async () => {
    const payload = await read(await startersRoute(new Request('https://os.nibrexo.test/api/workspace/email/starters'), {}));
    expect(payload.ok).toBe(true);
    const starters = (payload.data?.starters ?? []) as Array<{ id: string; design: { blocks: unknown[] } }>;
    expect(starters).toHaveLength(6);
    expect(starters.every((starter) => starter.design.blocks.length > 2)).toBe(true);
  });

  it('creates a design through the API and lists it back', async () => {
    const stored: unknown[] = [];
    const repo = {
      emailDesigns: {
        insert: vi.fn(async (row: Record<string, unknown>) => {
          const record = {
            id: 'design-1',
            organization_id: row.organization_id,
            name: row.name,
            category: row.category,
            subject: row.subject,
            design: row.design,
            status: row.status ?? 'draft',
            source: row.source ?? 'studio',
            template_id: null,
            created_by: row.created_by ?? null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          stored.push(record);
          return record;
        }),
        list: vi.fn(async () => stored),
      },
      activityLogs: { insert: vi.fn(async () => ({})) },
    } as unknown as NibrexoRepository;
    getRequestRepository.mockResolvedValue({ ok: true, data: repo });

    const created = await read(
      await createDesignRoute(
        request({ name: 'Launch', category: 'campaign', subject: 'Launch', design }, 'https://os.nibrexo.test/api/workspace/email/designs'),
        {},
      ),
    );
    expect(created.ok).toBe(true);
    expect(created.data?.status).toBe('draft');

    const listed = await read(await listDesignsRoute(new Request('https://os.nibrexo.test/api/workspace/email/designs'), {}));
    expect(listed.ok).toBe(true);
    expect(Array.isArray(listed.data?.designs)).toBe(true);
    expect((listed.data?.designs as unknown[]).length).toBe(1);
  });

  it('returns 404 for a missing design, matching the clients/templates convention', async () => {
    const repo = {
      emailDesigns: {
        get: vi.fn().mockResolvedValue(null),
        list: vi.fn().mockResolvedValue([]),
      },
    } as unknown as NibrexoRepository;
    getRequestRepository.mockResolvedValue({ ok: true, data: repo });

    const missing = '00000000-0000-0000-0000-00000000dead';
    const get = await getDesignRoute(new Request(`https://os.nibrexo.test/api/workspace/email/designs/${missing}`), {
      params: Promise.resolve({ id: missing }),
    });
    expect(get.status).toBe(404);
    expect((await read(get)).error?.code).toBe('DESIGN_NOT_FOUND');

    const remove = await deleteDesignRoute(
      new Request(`https://os.nibrexo.test/api/workspace/email/designs/${missing}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: missing }) },
    );
    expect(remove.status).toBe(404);
  });

  it('maps studio failures onto the HTTP status of their error class', () => {
    const issue = (code: string, errorClass: string) => ({
      code,
      message: code,
      severity: 'error' as const,
      retryable: false,
      errorClass: errorClass as never,
    });
    expect(studioFailure(issue('DESIGN_NOT_FOUND', 'validation')).status).toBe(404);
    expect(studioFailure(issue('PERMISSION_DENIED', 'permission')).status).toBe(403);
    expect(studioFailure(issue('DESIGN_INVALID', 'validation')).status).toBe(400);
    expect(studioFailure(issue('EMAIL_NOT_CONFIGURED', 'not_configured')).status).toBe(503);
    expect(studioFailure(issue('SOMETHING_ELSE', 'server')).status).toBe(500);
    expect(invalidStudioInput('bad').status).toBe(400);
  });

  it('refuses to create a design for a role without email:create', async () => {
    resolveActor.mockResolvedValue({ ok: true, data: { ...owner, role: 'client' } });
    const response = await createDesignRoute(
      request({ name: 'Nope', category: 'campaign', subject: 'Nope', design }, 'https://os.nibrexo.test/api/workspace/email/designs'),
      {},
    );
    expect(response.status).toBe(403);
    const payload = await read(response);
    expect(payload.error?.code).toBe('PERMISSION_DENIED');
  });
});
