'use client';

import { useState } from 'react';
import {
  EMAIL_BLOCK_TYPES,
  type EmailBlockType,
  type EmailBrandProfile,
  type EmailBrandTokens,
  type EmailSavedSection,
} from '@/types/email-design';
import { BLOCK_TYPE_DESCRIPTIONS, BLOCK_TYPE_LABELS } from '@/server/email/render/schema';
import { CANVAS_DRAG_MIME, encodeDragPayload, type CanvasDragPayload } from './DesignCanvas';

/**
 * Left-hand block library.
 *
 * Items are draggable onto the canvas (and onto the mobile/desktop preview),
 * and every item is also a button so the library is usable with a keyboard.
 */

const GROUPS: Array<{ label: string; types: EmailBlockType[] }> = [
  { label: 'Structure', types: ['header', 'background', 'spacer', 'divider', 'footer'] },
  { label: 'Content', types: ['hero', 'banner', 'promo', 'text', 'products', 'gallery', 'video'] },
  { label: 'Actions', types: ['button', 'social'] },
];

interface Props {
  brand: EmailBrandTokens;
  profile: EmailBrandProfile;
  canEdit: boolean;
  onAdd: (type: EmailBlockType) => void;
  onAddSection: (section: EmailSavedSection) => void;
  onOpenBrand: () => void;
}

export function BlockLibrary({ brand, profile, canEdit, onAdd, onAddSection, onOpenBrand }: Props) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const visible = EMAIL_BLOCK_TYPES.filter((type) =>
    needle ? `${BLOCK_TYPE_LABELS[type]} ${BLOCK_TYPE_DESCRIPTIONS[type]}`.toLowerCase().includes(needle) : true,
  );

  return (
    <div className="panel max-h-[calc(100vh-190px)] space-y-4 overflow-y-auto p-4">
      <div>
        <h2 className="card-title">Blocks</h2>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Drag a block onto the canvas, or select it to append it to the design.
        </p>
      </div>

      <input
        className="input py-2 text-xs"
        placeholder="Search blocks…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {GROUPS.map((group) => {
        const types = group.types.filter((type) => visible.includes(type));
        if (types.length === 0) return null;
        return (
          <div key={group.label} className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</p>
            {types.map((type) => (
              <button
                key={type}
                aria-disabled={!canEdit}
                className="block w-full rounded-xl border border-surface-border bg-surface/50 p-3 text-left transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
                draggable={canEdit}
                onClick={() => onAdd(type)}
                onDragStart={(event) => {
                  const payload: CanvasDragPayload = { kind: 'new-block', blockType: type };
                  event.dataTransfer.setData(CANVAS_DRAG_MIME, encodeDragPayload(payload));
                  event.dataTransfer.setData('text/plain', BLOCK_TYPE_LABELS[type]);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                type="button"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-100">{BLOCK_TYPE_LABELS[type]}</span>
                  <span className="text-[10px] text-slate-600">drag</span>
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-slate-500">{BLOCK_TYPE_DESCRIPTIONS[type]}</span>
              </button>
            ))}
          </div>
        );
      })}

      {profile.savedSections.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Reusable sections</p>
          {profile.savedSections.map((section) => (
            <button
              key={section.id}
              className="block w-full rounded-xl border border-brand-400/30 bg-brand-500/10 p-3 text-left transition hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canEdit}
              draggable={canEdit}
              onClick={() => onAddSection(section)}
              onDragStart={(event) => {
                const payload: CanvasDragPayload = { kind: 'section', sectionId: section.id };
                event.dataTransfer.setData(CANVAS_DRAG_MIME, encodeDragPayload(payload));
                event.dataTransfer.effectAllowed = 'copy';
              }}
              type="button"
            >
              <span className="text-sm font-medium text-slate-100">{section.name}</span>
              <span className="mt-1 block text-[11px] text-slate-400">
                Saved {section.block.type} section from your brand library.
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="border-t border-surface-border/70 pt-3">
        <p className="text-xs font-medium text-slate-300">Brand</p>
        <p className="mt-1 text-[11px] leading-4 text-slate-500">
          Logo, colours, typography, button style and header/footer defaults live in Brand settings and seed every new
          block.
        </p>
        <button className="btn-secondary mt-2 w-full justify-center text-xs" type="button" onClick={onOpenBrand}>
          Open brand settings
        </button>
      </div>

      <p className="text-[11px] leading-4 text-slate-600">
        Primary {brand.colors.primary} · Surface {brand.colors.surface}
      </p>
    </div>
  );
}
