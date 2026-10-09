'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, EmptyState } from '@/components/ui/primitives';
import { EMAIL_DESIGN_VERSION, type EmailBrandProfile, type EmailDesign, type EmailDesignDocument } from '@/types/email-design';
import { STARTER_TEMPLATES, starterVariables } from '@/server/email/starter-templates';
import { BLOCK_TYPE_LABELS } from '@/server/email/render/schema';
import { emptyDesignDocument } from './block-defaults';

/**
 * Email studio home: saved designs, starter templates and the blank-design
 * entry point. Every starter is a real, editable design document.
 */

interface Props {
  designs: EmailDesign[];
  brandProfile: EmailBrandProfile;
  canCreate: boolean;
  canDelete: boolean;
  canManageBrand: boolean;
}

export function StudioWorkspace({ designs, brandProfile, canCreate, canDelete, canManageBrand }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(document: EmailDesignDocument, name: string, category: string, subject: string, key: string) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch('/api/workspace/email/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, subject, design: document, status: 'draft', source: 'studio' }),
      });
      const payload = (await response.json()) as { ok: boolean; data?: EmailDesign; error?: { message: string } };
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'Could not create the design.');
        return;
      }
      router.push(`/email/studio/${payload.data.id}`);
    } catch {
      setError('Could not reach the server to create the design.');
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/email/designs/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as { ok: boolean; data?: EmailDesign; error?: { message: string } };
      if (!payload.ok || !payload.data) {
        setError(payload.error?.message ?? 'Could not duplicate the design.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/workspace/email/designs/${id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not delete the design.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary"
          disabled={!canCreate || busy !== null}
          type="button"
          onClick={() =>
            void create(
              emptyDesignDocument(brandProfile),
              'Untitled design',
              'general',
              'Your subject line',
              'blank',
            )
          }
        >
          {busy === 'blank' ? 'Creating…' : 'New blank design'}
        </button>
        <Link className="btn-secondary" href="/email/brand">
          Brand settings
        </Link>
        <Link className="btn-secondary" href="/email/templates">
          Email templates
        </Link>
      </div>

      {error ? <p className="text-xs leading-5 text-red-200">{error}</p> : null}
      {!canManageBrand ? (
        <p className="text-xs leading-5 text-slate-500">
          Brand settings are organization-wide and require an owner or admin role.
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="card-title">Saved designs ({designs.length})</h2>
        </div>
        {designs.length === 0 ? (
          <EmptyState
            description="Create a blank design or start from a polished starter below. Designs are saved as drafts and can be promoted into reusable email templates."
            title="No designs yet"
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {designs.map((design) => (
              <article className="panel space-y-3 p-4" key={design.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      <Link className="hover:underline" href={`/email/studio/${design.id}`}>
                        {design.name}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {design.category} · {design.design.blocks.length} block
                      {design.design.blocks.length === 1 ? '' : 's'} · v{design.design.version}
                    </p>
                  </div>
                  <Badge tone={design.status === 'active' ? 'success' : design.status === 'archived' ? 'neutral' : 'warning'}>
                    {design.status}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400">{design.subject.slice(0, 90)}</p>
                <p className="text-[11px] text-slate-600">
                  {design.design.blocks
                    .slice(0, 6)
                    .map((block) => BLOCK_TYPE_LABELS[block.type])
                    .join(' · ')}
                  {design.design.blocks.length > 6 ? ' · …' : ''}
                </p>
                {design.template_id ? (
                  <p className="text-[11px] text-emerald-200">Promoted to an email template.</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Link className="btn-secondary px-3 py-1.5 text-xs" href={`/email/studio/${design.id}`}>
                    Open in studio
                  </Link>
                  <button
                    className="btn-ghost px-2 py-1 text-xs"
                    disabled={!canCreate || busy !== null}
                    type="button"
                    onClick={() => void duplicate(design.id)}
                  >
                    Duplicate
                  </button>
                  <button
                    className="btn-ghost px-2 py-1 text-xs text-red-200"
                    disabled={!canDelete || busy !== null}
                    type="button"
                    onClick={() => void remove(design.id, design.name)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="card-title">Starter templates</h2>
        <p className="text-xs leading-5 text-slate-400">
          Polished, fully editable starting points. Each one is a real design document made of the same blocks the studio
          edits — open one, replace the copy, pick Content Library assets and save it as a draft.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {STARTER_TEMPLATES.map((starter) => (
            <article className="panel flex flex-col space-y-3 p-4" key={starter.id}>
              <div>
                <h3 className="text-sm font-semibold text-slate-100">{starter.name}</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">{starter.description}</p>
              </div>
              <p className="text-[11px] leading-4 text-slate-600">
                {starter.design.blocks.map((block) => BLOCK_TYPE_LABELS[block.type]).join(' · ')}
              </p>
              <p className="text-[11px] text-slate-500">
                Variables: {starterVariables(starter).slice(0, 6).join(', ') || 'none'}
              </p>
              <div className="mt-auto flex gap-2">
                <button
                  className="btn-secondary px-3 py-1.5 text-xs"
                  disabled={!canCreate || busy !== null}
                  type="button"
                  onClick={() =>
                    void create(
                      starter.design,
                      `${starter.name} (${new Date().toLocaleDateString()})`,
                      starter.category,
                      starter.subject,
                      starter.id,
                    )
                  }
                >
                  {busy === starter.id ? 'Creating…' : 'Use this starter'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <p className="text-[11px] leading-4 text-slate-600">
        Document schema version {EMAIL_DESIGN_VERSION}. Designs are organization-scoped; another organization can never
        read, edit or duplicate them.
      </p>
    </div>
  );
}
