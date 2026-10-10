'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmailBlockType } from '@/types/email-design';

/**
 * The email canvas.
 *
 * The canvas is the real rendered document: the server-rendered HTML is loaded
 * into an iframe (`srcDoc`), so what the user sees is exactly what a mail
 * client would lay out — table layout, inline CSS, image fallbacks, mobile
 * media query and all.
 *
 * Because the renderer tags every block with `data-email-block`, the parent can
 * read the real element positions out of the iframe and overlay selection
 * outlines, drag handles and drop indicators on top of the actual design. That
 * is what makes drag-and-drop reorder and click-to-select work on the real
 * artefact instead of on a mock list.
 */

export interface CanvasInsertPayload {
  kind: 'new-block';
  blockType: EmailBlockType;
}

export interface CanvasMovePayload {
  kind: 'move';
  from: number;
}

export interface CanvasSectionPayload {
  kind: 'section';
  sectionId: string;
}

export type CanvasDragPayload = CanvasInsertPayload | CanvasMovePayload | CanvasSectionPayload;

interface Props {
  html: string | null;
  rendering: boolean;
  designWidth: number;
  device: 'desktop' | 'mobile';
  selectedId: string | null;
  blockIds: string[];
  onSelect: (id: string | null) => void;
  onInsert: (payload: CanvasDragPayload, index: number) => void;
  onReorder: (from: number, to: number) => void;
  canEdit: boolean;
}

interface Box {
  id: string;
  top: number;
  height: number;
}

const DRAG_MIME = 'application/x-nibrexo-email-block';

export function DesignCanvas({
  html,
  rendering,
  designWidth,
  device,
  selectedId,
  blockIds,
  onSelect,
  onInsert,
  onReorder,
  canEdit,
}: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragPayload, setDragPayload] = useState<CanvasDragPayload | null>(null);

  const measure = useCallback(() => {
    const doc = iframe.current?.contentDocument;
    if (!doc) return;
    const view = doc.defaultView;
    const scrollY = view?.scrollY ?? 0;
    const elements = Array.from(doc.querySelectorAll<HTMLElement>('[data-email-block]'));
    const next: Box[] = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.emailBlock ?? '',
        top: rect.top + scrollY,
        height: rect.height,
      };
    });
    setBoxes(next);
    const height = doc.body?.scrollHeight ?? 600;
    const frame = iframe.current;
    if (frame) frame.style.height = `${Math.min(Math.max(height + 24, 420), 6000)}px`;
  }, []);

  // Re-measure whenever the rendered document changes.
  useEffect(() => {
    setBoxes([]);
  }, [html]);

  const attach = useCallback(() => {
    const doc = iframe.current?.contentDocument;
    if (!doc) return;
    measure();

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const block = target?.closest('[data-email-block]') as HTMLElement | null;
      event.preventDefault();
      onSelect(block?.dataset.emailBlock ?? null);
    };
    const onScroll = () => measure();
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('scroll', onScroll, true);
    return () => {
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('scroll', onScroll, true);
    };
  }, [measure, onSelect]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  const canvasWidth = device === 'mobile' ? 375 : Math.min(designWidth, 760);

  function readPayload(event: React.DragEvent): CanvasDragPayload | null {
    const raw = event.dataTransfer.getData(DRAG_MIME);
    if (raw) {
      try {
        return JSON.parse(raw) as CanvasDragPayload;
      } catch {
        return null;
      }
    }
    return dragPayload;
  }

  function handleDrop(event: React.DragEvent, index: number) {
    event.preventDefault();
    const payload = readPayload(event);
    setDropIndex(null);
    setDragPayload(null);
    if (!payload) return;
    if (payload.kind === 'move') {
      if (payload.from === index || payload.from === index - 1) return;
      const target = payload.from < index ? index - 1 : index;
      onReorder(payload.from, target);
      return;
    }
    onInsert(payload, index);
  }

  return (
    <div className="panel flex min-h-[520px] flex-col p-0">
      <div className="flex items-center justify-between gap-3 border-b border-surface-border/70 px-4 py-2.5">
        <p className="text-xs font-medium text-slate-300">
          {device === 'mobile' ? 'Mobile preview' : 'Desktop preview'}
          <span className="ml-2 text-[11px] text-slate-500">
            {canvasWidth}px · rendered email HTML
          </span>
        </p>
        <p className="text-[11px] text-slate-500">
          {blockIds.length} block{blockIds.length === 1 ? '' : 's'}
          {rendering ? ' · rendering…' : ''}
        </p>
      </div>

      <div className="flex-1 overflow-auto bg-[#0b1220] p-4">
        <div className="mx-auto" style={{ width: canvasWidth, maxWidth: '100%' }}>
          <div className="relative">
            {html ? (
              <>
                <iframe
                  className="w-full rounded-xl border border-surface-border bg-white"
                  onLoad={(event) => {
                    const cleanup = attach();
                    (event.currentTarget as HTMLIFrameElement).dataset.attached = 'true';
                    // Keep the listener for the lifetime of this document.
                    iframe.current?.addEventListener('unload', () => cleanup?.());
                  }}
                  ref={iframe}
                  srcDoc={html}
                  title="Email design preview"
                />
                {/* Overlay layer: selection outlines, drag handles, drop targets. */}
                <div className="pointer-events-none absolute inset-0">
                  {boxes.map((box, index) => {
                    const selected = box.id === selectedId;
                    return (
                      <div
                        className="pointer-events-auto absolute left-0 w-full"
                        key={box.id}
                        style={{ top: box.top, height: box.height }}
                      >
                        <div
                          className={`group h-full w-full cursor-pointer rounded-md transition ${
                            selected ? 'ring-2 ring-brand-400' : 'hover:ring-1 hover:ring-brand-300/60'
                          }`}
                          draggable={canEdit}
                          onClick={() => onSelect(box.id)}
                          onDragEnd={() => {
                            setDragPayload(null);
                            setDropIndex(null);
                          }}
                          onDragOver={(event) => {
                            if (!canEdit) return;
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            const after = event.clientY > rect.top + rect.height / 2;
                            setDropIndex(after ? index + 1 : index);
                          }}
                          onDragStart={(event) => {
                            event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'move', from: index }));
                            event.dataTransfer.effectAllowed = 'move';
                            setDragPayload({ kind: 'move', from: index });
                          }}
                          onDrop={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            const after = event.clientY > rect.top + rect.height / 2;
                            handleDrop(event, after ? index + 1 : index);
                          }}
                        >
                          {canEdit ? (
                            <span
                              className="absolute -top-3 left-1 hidden rounded-md bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow group-hover:block"
                              title="Drag to reorder"
                            >
                              ⠿ {index + 1}
                            </span>
                          ) : null}
                        </div>
                        {dropIndex === index ? <DropLine /> : null}
                        {dropIndex === index + 1 && index === boxes.length - 1 ? <DropLine bottom /> : null}
                      </div>
                    );
                  })}
                  {dropIndex === boxes.length && boxes.length > 0
                    ? (() => {
                        const last = boxes[boxes.length - 1];
                        if (!last) return null;
                        return (
                          <div className="pointer-events-none absolute inset-x-0" style={{ top: last.top + last.height }}>
                            <DropLine />
                          </div>
                        );
                      })()
                    : null}
                </div>
              </>
            ) : (
              <div className="flex h-[420px] items-center justify-center rounded-xl border border-dashed border-surface-border bg-surface/40">
                <p className="text-sm text-slate-400">{rendering ? 'Rendering the email…' : 'Add a block to start the design.'}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DropLine({ bottom = false }: { bottom?: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 h-0.5 bg-brand-400 ${bottom ? 'bottom-0' : 'top-0'}`}
      style={{ boxShadow: '0 0 0 1px rgba(61,124,244,0.35)' }}
    />
  );
}

/** Drag payload helpers used by the block library. */
export function encodeDragPayload(payload: CanvasDragPayload): string {
  return JSON.stringify(payload);
}

export const CANVAS_DRAG_MIME = DRAG_MIME;
