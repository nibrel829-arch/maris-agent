'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EMAIL_DESIGN_VERSION,
  type EmailBlock,
  type EmailBlockType,
  type EmailBrandProfile,
  type EmailDesign,
  type EmailDesignDocument,
  type EmailDesignStatus,
  type EmailSavedSection,
  type EmailValidationIssue,
  type RenderedEmail,
} from '@/types/email-design';
import { BlockLibrary } from './BlockLibrary';
import { DesignCanvas, type CanvasDragPayload } from './DesignCanvas';
import { PropertiesPanel } from './PropertiesPanel';
import { TestEmailPanel } from './TestEmailPanel';
import { createBlock } from './block-defaults';

/**
 * The visual email studio.
 *
 * Owns the design document, the undo/redo history, autosave and the live
 * render pipeline. The canvas and every preview tab are fed by one server
 * render of the *current* document, so what is shown is the artefact.
 */

interface Props {
  design: EmailDesign;
  brandProfile: EmailBrandProfile;
  canEdit: boolean;
  canSend: boolean;
  canDelete: boolean;
  canManageBrand: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface HistoryState {
  past: EmailDesignDocument[];
  future: EmailDesignDocument[];
}
type Tab = 'design' | 'html' | 'text' | 'validate' | 'send';

const RENDER_DEBOUNCE_MS = 350;
const AUTOSAVE_DEBOUNCE_MS = 1400;

export function EmailStudioBuilder({
  design,
  brandProfile,
  canEdit,
  canSend,
  canDelete,
  canManageBrand,
}: Props) {
  const router = useRouter();

  const [document, setDocument] = useState<EmailDesignDocument>(design.design);
  const [meta, setMeta] = useState({
    name: design.name,
    category: design.category,
    subject: design.subject,
    status: design.status,
  });
  const [selectedId, setSelectedId] = useState<string | null>(design.design.blocks[0]?.id ?? null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [tab, setTab] = useState<Tab>('design');
  const [variablesRaw, setVariablesRaw] = useState('{}');
  const [rendered, setRendered] = useState<RenderedEmail | null>(null);
  const [rendering, setRendering] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(design.updated_at);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({ past: [], future: [] });

  const docRef = useRef(document);
  const dirtyRef = useRef(false);
  const metaRef = useRef(meta);

  docRef.current = document;
  metaRef.current = meta;

  const selectedBlock = useMemo(
    () => document.blocks.find((block) => block.id === selectedId) ?? null,
    [document.blocks, selectedId],
  );

  /* ---------------------------------------------------------------- history */

  const applyDocument = useCallback((next: EmailDesignDocument, pushHistory = true) => {
    const previous = docRef.current;
    if (previous === next) return;
    if (pushHistory) {
      setHistory((state) => ({ past: [...state.past.slice(-49), previous], future: [] }));
    }
    docRef.current = next;
    dirtyRef.current = true;
    setDocument(next);
  }, []);

  const undo = useCallback(() => {
    setHistory((state) => {
      const previous = state.past.at(-1);
      if (!previous) return state;
      const current = docRef.current;
      docRef.current = previous;
      dirtyRef.current = true;
      setDocument(previous);
      return { past: state.past.slice(0, -1), future: [current, ...state.future].slice(0, 50) };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((state) => {
      const next = state.future[0];
      if (!next) return state;
      const current = docRef.current;
      docRef.current = next;
      dirtyRef.current = true;
      setDocument(next);
      return { past: [...state.past, current].slice(-50), future: state.future.slice(1) };
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  /* ------------------------------------------------------------- mutations */

  const insertBlock = useCallback(
    (block: EmailBlock, index = docRef.current.blocks.length) => {
      const next: EmailDesignDocument = {
        ...docRef.current,
        blocks: [...docRef.current.blocks.slice(0, index), block, ...docRef.current.blocks.slice(index)],
      };
      applyDocument(next);
      setSelectedId(block.id);
    },
    [applyDocument],
  );

  const reorder = useCallback(
    (from: number, to: number) => {
      const blocks = [...docRef.current.blocks];
      const [moved] = blocks.splice(from, 1);
      if (!moved) return;
      blocks.splice(Math.max(0, Math.min(blocks.length, to)), 0, moved);
      applyDocument({ ...docRef.current, blocks });
    },
    [applyDocument],
  );

  const removeBlock = useCallback(
    (id: string) => {
      const next: EmailDesignDocument = {
        ...docRef.current,
        blocks: docRef.current.blocks.filter((block) => block.id !== id),
      };
      applyDocument(next);
      setSelectedId(null);
    },
    [applyDocument],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      const index = docRef.current.blocks.findIndex((block) => block.id === id);
      if (index < 0) return;
      const source = docRef.current.blocks[index];
      if (!source) return;
      const copy = JSON.parse(JSON.stringify(source)) as EmailBlock;
      copy.id = `${source.type}_${Math.random().toString(36).slice(2, 9)}`;
      insertBlock(copy, index + 1);
    },
    [insertBlock],
  );

  const patchBlock = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const blocks = docRef.current.blocks.map((block) =>
        block.id === id ? ({ ...block, props: { ...block.props, ...patch } } as EmailBlock) : block,
      );
      applyDocument({ ...docRef.current, blocks });
    },
    [applyDocument],
  );

  const replaceBlock = useCallback(
    (block: EmailBlock) => {
      const blocks = docRef.current.blocks.map((candidate) => (candidate.id === block.id ? block : candidate));
      applyDocument({ ...docRef.current, blocks });
    },
    [applyDocument],
  );

  const handleCanvasInsert = useCallback(
    (payload: CanvasDragPayload, index: number) => {
      const defaults = { brand: docRef.current.brand, profile: brandProfile };
      if (payload.kind === 'new-block') {
        insertBlock(createBlock(payload.blockType, defaults), index);
        return;
      }
      if (payload.kind === 'section') {
        const section = brandProfile.savedSections.find((entry) => entry.id === payload.sectionId);
        if (!section) return;
        const copy = JSON.parse(JSON.stringify(section.block)) as EmailBlock;
        copy.id = `${section.block.type}_${Math.random().toString(36).slice(2, 9)}`;
        insertBlock(copy, index);
      }
    },
    [brandProfile, insertBlock],
  );

  /* ------------------------------------------------------- brand + settings */

  const applyBrandProfile = useCallback(() => {
    const current = docRef.current;
    const headerIndex = current.blocks.findIndex((block) => block.type === 'header');
    const footerIndex = current.blocks.findIndex((block) => block.type === 'footer');
    const blocks = [...current.blocks];

    if (headerIndex >= 0) {
      const header = blocks[headerIndex];
      if (header && header.type === 'header') {
        blocks[headerIndex] = {
          ...header,
          props: {
            ...header.props,
            brandName: brandProfile.headerDefaults.brandName || brandProfile.brandName,
            logo: brandProfile.headerDefaults.logo,
            navLinks: brandProfile.headerDefaults.navLinks,
            showNav: brandProfile.headerDefaults.showNav,
          },
        };
      }
    }
    if (footerIndex >= 0) {
      const footer = blocks[footerIndex];
      if (footer && footer.type === 'footer') {
        blocks[footerIndex] = {
          ...footer,
          props: { ...footer.props, ...brandProfile.footerDefaults },
        };
      }
    }

    applyDocument({
      ...current,
      brand: {
        colors: { ...brandProfile.colors },
        typography: { ...brandProfile.typography },
        button: { ...brandProfile.button },
      },
      blocks,
      settings: {
        ...current.settings,
        backgroundColor: brandProfile.colors.background,
        surfaceColor: brandProfile.colors.surface,
        fontFamily: brandProfile.typography.bodyFont,
      },
    });
    setNotice('Brand tokens, header and footer defaults applied to this design.');
  }, [applyDocument, brandProfile]);

  /* --------------------------------------------------------------- render */

  const variables = useMemo(() => {
    try {
      const parsed = JSON.parse(variablesRaw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          out[key] = typeof value === 'string' ? value : String(value ?? '');
        }
        return out;
      }
      return {};
    } catch {
      return {};
    }
  }, [variablesRaw]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setRendering(true);
      try {
        const response = await fetch('/api/workspace/email/designs/render-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ design: docRef.current, variables }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          ok: boolean;
          data?: RenderedEmail;
          error?: { message: string };
        };
        if (!payload.ok || !payload.data) {
          setError(payload.error?.message ?? 'Could not render the design.');
          return;
        }
        setError(null);
        setRendered(payload.data);
      } catch (fetchError) {
        if ((fetchError as Error).name === 'AbortError') return;
        setError('Could not reach the server to render the design.');
      } finally {
        setRendering(false);
      }
    }, RENDER_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [document, variables]);

  /* ------------------------------------------------------------- autosave */

  const save = useCallback(
    async (nextMeta?: Partial<typeof meta>) => {
      const payload = {
        ...metaRef.current,
        ...nextMeta,
        design: docRef.current,
      };
      setSaveState('saving');
      try {
        const response = await fetch(`/api/workspace/email/designs/${design.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = (await response.json()) as { ok: boolean; data?: EmailDesign; error?: { message: string } };
        if (!result.ok) {
          setSaveState('error');
          setError(result.error?.message ?? 'Could not save the design.');
          return false;
        }
        dirtyRef.current = false;
        setSaveState('saved');
        setLastSavedAt(new Date().toISOString());
        if (nextMeta) setMeta((current) => ({ ...current, ...nextMeta }));
        return true;
      } catch {
        setSaveState('error');
        setError('Could not reach the server to save the design.');
        return false;
      }
    },
    [design.id],
  );

  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = setTimeout(() => {
      void save();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [document, meta, save]);

  /* ---------------------------------------------------------------- actions */

  async function duplicateDesign() {
    const response = await fetch(`/api/workspace/email/designs/${design.id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = (await response.json()) as { ok: boolean; data?: EmailDesign; error?: { message: string } };
    if (!payload.ok || !payload.data) {
      setError(payload.error?.message ?? 'Could not duplicate the design.');
      return;
    }
    router.push(`/email/studio/${payload.data.id}`);
  }

  async function deleteDesign() {
    if (!window.confirm(`Delete "${meta.name}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/workspace/email/designs/${design.id}`, { method: 'DELETE' });
    const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
    if (!payload.ok) {
      setError(payload.error?.message ?? 'Could not delete the design.');
      return;
    }
    router.push('/email/studio');
  }

  async function promote() {
    const okSave = await save();
    if (!okSave) return;
    const response = await fetch(`/api/workspace/email/designs/${design.id}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'draft' }),
    });
    const payload = (await response.json()) as {
      ok: boolean;
      data?: { template: { id: string; name: string; status: string } };
      error?: { message: string };
    };
    if (!payload.ok || !payload.data) {
      setError(payload.error?.message ?? 'Could not create the template.');
      return;
    }
    setNotice(
      `Saved as email template "${payload.data.template.name}" (${payload.data.template.status}). It is available in the composer, sequences and campaigns — sending still requires approval.`,
    );
    router.refresh();
  }

  const blockingCount = rendered?.validation.errors.length ?? 0;
  const warningCount = rendered?.validation.warnings.length ?? 0;
  const totalIssues = blockingCount + warningCount;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------- toolbar */}
      <div className="panel space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.4fr)]">
          <label className="block text-xs font-medium text-slate-300">
            Design name
            <input
              className="input mt-1"
              disabled={!canEdit}
              maxLength={120}
              value={meta.name}
              onChange={(event) => setMeta((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-slate-300">
            Category
            <input
              className="input mt-1"
              disabled={!canEdit}
              maxLength={80}
              value={meta.category}
              onChange={(event) => setMeta((current) => ({ ...current, category: event.target.value }))}
            />
          </label>
          <label className="block text-xs font-medium text-slate-300">
            Status
            <select
              className="input mt-1"
              disabled={!canEdit}
              value={meta.status}
              onChange={(event) => setMeta((current) => ({ ...current, status: event.target.value as EmailDesignStatus }))}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>

        <label className="block text-xs font-medium text-slate-300">
          Subject line
          <input
            className="input mt-1"
            disabled={!canEdit}
            maxLength={300}
            value={meta.subject}
            onChange={(event) => setMeta((current) => ({ ...current, subject: event.target.value }))}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={!canEdit} type="button" onClick={() => void save()}>
            Save now
          </button>
          <button className="btn-secondary" disabled={!canEdit || history.past.length === 0} type="button" onClick={undo}>
            Undo
          </button>
          <button className="btn-secondary" disabled={!canEdit || history.future.length === 0} type="button" onClick={redo}>
            Redo
          </button>
          <button className="btn-secondary" disabled={!canEdit} type="button" onClick={() => void duplicateDesign()}>
            Duplicate design
          </button>
          <button className="btn-secondary" disabled={!canManageBrand} type="button" onClick={applyBrandProfile}>
            Apply brand defaults
          </button>
          <button className="btn-secondary" type="button" onClick={() => void promote()}>
            Save as email template
          </button>
          <button className="btn-danger" disabled={!canDelete} type="button" onClick={() => void deleteDesign()}>
            Delete
          </button>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
            <span
              className={`badge ${
                saveState === 'error'
                  ? 'bg-red-500/10 text-red-200'
                  : saveState === 'saving'
                    ? 'bg-amber-500/10 text-amber-200'
                    : saveState === 'saved'
                      ? 'bg-emerald-500/10 text-emerald-200'
                      : 'bg-slate-500/10 text-slate-300'
              }`}
            >
              {saveState === 'saving'
                ? 'Saving…'
                : saveState === 'error'
                  ? 'Save failed'
                  : dirtyRef.current
                    ? 'Unsaved changes'
                    : 'Autosaved'}
            </span>
            {lastSavedAt ? <span>Last saved {new Date(lastSavedAt).toLocaleTimeString()}</span> : null}
          </span>
        </div>

        {notice ? <p className="text-xs leading-5 text-emerald-200">{notice}</p> : null}
        {error ? <p className="text-xs leading-5 text-red-200">{error}</p> : null}
      </div>

      {/* ---------------------------------------------------------------- tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['design', 'Design'],
            ['validate', totalIssues > 0 ? `Validation (${blockingCount} blocking, ${warningCount} warnings)` : 'Validation'],
            ['html', 'HTML source'],
            ['text', 'Plain text'],
            ['send', 'Test email'],
          ] as Array<[Tab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            className={`btn-ghost px-3 py-1.5 text-xs ${tab === value ? 'bg-surface-raised text-white' : ''}`}
            type="button"
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
        {tab === 'design' ? (
          <div className="ml-auto flex items-center gap-1 rounded-xl border border-surface-border p-1">
            {(['desktop', 'mobile'] as const).map((value) => (
              <button
                key={value}
                className={`rounded-lg px-3 py-1 text-xs ${device === value ? 'bg-brand-500 text-white' : 'text-slate-300'}`}
                type="button"
                onClick={() => setDevice(value)}
              >
                {value === 'desktop' ? 'Desktop' : 'Mobile'}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* --------------------------------------------------------------- body */}
      {tab === 'design' ? (
        <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
          <BlockLibrary
            brand={document.brand}
            canEdit={canEdit}
            profile={brandProfile}
            onAdd={(type: EmailBlockType) => insertBlock(createBlock(type, { brand: document.brand, profile: brandProfile }))}
            onAddSection={(section: EmailSavedSection) => {
              const copy = JSON.parse(JSON.stringify(section.block)) as EmailBlock;
              copy.id = `${section.block.type}_${Math.random().toString(36).slice(2, 9)}`;
              insertBlock(copy);
            }}
            onOpenBrand={() => router.push('/email/brand')}
          />
          <DesignCanvas
            blockIds={document.blocks.map((block) => block.id)}
            canEdit={canEdit}
            designWidth={document.settings.width}
            device={device}
            html={rendered?.html ?? null}
            rendering={rendering}
            selectedId={selectedId}
            onInsert={handleCanvasInsert}
            onReorder={reorder}
            onSelect={setSelectedId}
          />
          <PropertiesPanel
            block={selectedBlock}
            brand={document.brand}
            canEdit={canEdit}
            onDelete={() => selectedId && removeBlock(selectedId)}
            onDuplicate={() => selectedId && duplicateBlock(selectedId)}
            onMove={(direction) => {
              const index = document.blocks.findIndex((block) => block.id === selectedId);
              if (index < 0) return;
              reorder(index, index + direction);
            }}
            onPatch={(patch) => selectedId && patchBlock(selectedId, patch)}
            onReplaceBlock={replaceBlock}
            profile={brandProfile}
          />
        </div>
      ) : null}

      {tab === 'validate' && rendered ? (
        <ValidationPanel issues={rendered.validation.errors.concat(rendered.validation.warnings, rendered.validation.info)} />
      ) : null}
      {tab === 'validate' && !rendered ? <p className="text-sm text-slate-400">Rendering the design to validate it…</p> : null}

      {tab === 'html' ? (
        <div className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Rendered HTML</h2>
            <span className="text-[11px] text-slate-500">
              {rendered ? `${rendered.html.length.toLocaleString()} characters · table layout, inline CSS, no JavaScript` : '—'}
            </span>
          </div>
          <textarea className="input h-[520px] font-mono text-[11px]" readOnly value={rendered?.html ?? ''} />
        </div>
      ) : null}

      {tab === 'text' ? (
        <div className="panel space-y-3 p-4">
          <h2 className="card-title">Plain-text alternative</h2>
          <textarea className="input h-[420px] font-mono text-[11px]" readOnly value={rendered?.text ?? ''} />
          <p className="text-[11px] leading-4 text-slate-500">
            This text part is sent alongside the HTML part so clients and recipients that prefer plain text still receive
            the message, including the unsubscribe link.
          </p>
        </div>
      ) : null}

      {tab === 'send' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <TestEmailPanel
            canSend={canSend}
            designId={design.id}
            designName={meta.name}
            onSaved={() => save()}
            subject={meta.subject}
          />
          <div className="panel space-y-3 p-4">
            <h2 className="card-title">Preview variables</h2>
            <p className="text-xs leading-5 text-slate-400">
              Values for <span className="font-mono">{'{{variables}}'}</span> used in the design. They are resolved in the
              canvas and in the test email.
            </p>
            <textarea
              className="input h-40 font-mono text-xs"
              value={variablesRaw}
              onChange={(event) => setVariablesRaw(event.target.value)}
            />
            {rendered && rendered.unresolvedVariables.length > 0 ? (
              <p className="text-xs leading-5 text-amber-200">
                Unresolved: {rendered.unresolvedVariables.join(', ')}
              </p>
            ) : (
              <p className="text-xs leading-5 text-emerald-200">All placeholders resolved.</p>
            )}
            <p className="text-[11px] leading-4 text-slate-500">
              Document version {document.version} · canvas {document.settings.width}px · {document.blocks.length} blocks
              {document.version < EMAIL_DESIGN_VERSION ? ' · older document version, defaults applied on render' : ''}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ValidationPanel({ issues }: { issues: EmailValidationIssue[] }) {
  const tone = (severity: EmailValidationIssue['severity']) =>
    severity === 'error' ? 'text-red-200' : severity === 'warning' ? 'text-amber-100' : 'text-slate-300';

  return (
    <div className="panel space-y-3 p-4">
      <h2 className="card-title">Validation</h2>
      {issues.length === 0 ? (
        <p className="text-sm text-emerald-200">No issues found. The design is ready to preview and test.</p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue, index) => (
            <li className="panel-subtle p-3" key={`${issue.code}-${index}`}>
              <div className="flex items-center gap-2">
                <span
                  className={`badge ${
                    issue.severity === 'error'
                      ? 'bg-red-500/10 text-red-200'
                      : issue.severity === 'warning'
                        ? 'bg-amber-500/10 text-amber-100'
                        : 'bg-slate-500/10 text-slate-300'
                  }`}
                >
                  {issue.severity}
                </span>
                <span className="font-mono text-[11px] text-slate-500">{issue.code}</span>
              </div>
              <p className={`mt-1 text-xs leading-5 ${tone(issue.severity)}`}>{issue.message}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-4 text-slate-500">
        Errors block a test send. Link checks validate the scheme and format of every URL; they do not fetch the
        destination.
      </p>
    </div>
  );
}
