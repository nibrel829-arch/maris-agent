'use client';

import { useRef, useState } from 'react';
import {
  EMAIL_SOCIAL_PLATFORMS,
  type EmailBlock,
  type EmailBrandProfile,
  type EmailBrandTokens,
  type EmailGalleryItem,
  type EmailProductCard,
  type EmailSocialPlatform,
} from '@/types/email-design';
import {
  AlignmentField,
  ColorField,
  ColumnsField,
  ImageField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  ToggleField,
} from './fields';
import { createBlockId } from './block-defaults';

/**
 * Right-hand properties and styling panel.
 *
 * Every control writes straight into the selected block's props; the parent
 * owns the document, so undo/redo and autosave apply to these edits too.
 */

interface Props {
  block: EmailBlock | null;
  brand: EmailBrandTokens;
  profile: EmailBrandProfile;
  onPatch: (patch: Record<string, unknown>) => void;
  onReplaceBlock: (block: EmailBlock) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  canEdit: boolean;
}

const RICH_TEXT_HINT =
  'Allowed: bold, italic, underline, links, lists, headings and paragraphs. Anything else is removed before rendering.';

export function PropertiesPanel({
  block,
  brand,
  profile,
  onPatch,
  onReplaceBlock,
  onDelete,
  onDuplicate,
  onMove,
  canEdit,
}: Props) {
  if (!block) {
    return (
      <div className="panel p-4">
        <h2 className="card-title">Properties</h2>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Select a block on the canvas to edit its content and styling. Drag a block from the library on the left to add
          it to the design.
        </p>
        {profile.savedSections.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-300">Reusable sections</p>
            <ul className="mt-2 space-y-1 text-xs text-slate-400">
              {profile.savedSections.map((section) => (
                <li key={section.id}>{section.name}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  const disabled = !canEdit;

  return (
    <div className="panel max-h-[calc(100vh-190px)] space-y-4 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="card-title">Properties</h2>
          <p className="mt-1 text-xs text-slate-400">
            {block.type} block <span className="font-mono text-[10px] text-slate-600">{block.id.slice(0, 12)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <button className="btn-ghost px-2 py-1 text-[11px]" disabled={disabled} type="button" onClick={() => onMove(-1)}>
            ↑
          </button>
          <button className="btn-ghost px-2 py-1 text-[11px]" disabled={disabled} type="button" onClick={() => onMove(1)}>
            ↓
          </button>
          <button className="btn-ghost px-2 py-1 text-[11px]" disabled={disabled} type="button" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="btn-ghost px-2 py-1 text-[11px] text-red-200" disabled={disabled} type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      {disabled ? (
        <p className="rounded-xl border border-amber-300/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
          Your role can view this design but not edit it (requires email:edit).
        </p>
      ) : null}

      <BlockEditor block={block} brand={brand} onPatch={onPatch} onReplaceBlock={onReplaceBlock} disabled={disabled} />
    </div>
  );
}

function BlockEditor({
  block,
  brand,
  onPatch,
  onReplaceBlock,
  disabled,
}: {
  block: EmailBlock;
  brand: EmailBrandTokens;
  onPatch: (patch: Record<string, unknown>) => void;
  onReplaceBlock: (block: EmailBlock) => void;
  disabled: boolean;
}) {
  switch (block.type) {
    case 'header':
      return (
        <>
          <TextField label="Brand name" value={block.props.brandName} onChange={(v) => onPatch({ brandName: v })} />
          <ImageField
            label="Logo"
            image={block.props.logo}
            onChange={(image) => onPatch({ logo: image })}
            hint="Choose a logo from the Content Library. The brand name is shown when no logo is set."
          />
          <ToggleField
            checked={block.props.showNav}
            label="Show navigation links"
            onChange={(v) => onPatch({ showNav: v })}
          />
          {block.props.showNav ? (
            <LinkListEditor
              links={block.props.navLinks}
              onChange={(links) => onPatch({ navLinks: links })}
              label="Navigation links"
              disabled={disabled}
            />
          ) : null}
          <AlignmentField value={block.props.alignment} onChange={(v) => onPatch({ alignment: v })} />
          <ColorField
            brandFallback={brand.colors.surface}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
          <ColorField
            brandFallback={brand.colors.text}
            label="Text colour"
            onChange={(v) => onPatch({ textColor: v })}
            value={block.props.textColor}
          />
        </>
      );

    case 'hero':
      return (
        <>
          <ImageField label="Hero image" image={block.props.image} onChange={(image) => onPatch({ image })} />
          <TextField label="Headline" value={block.props.headline} onChange={(v) => onPatch({ headline: v })} maxLength={200} />
          <TextAreaField
            label="Description"
            rows={3}
            value={block.props.description}
            onChange={(v) => onPatch({ description: v })}
          />
          <ToggleField checked={block.props.overlay} label="Text over image" onChange={(v) => onPatch({ overlay: v })} />
          <CtaEditor
            cta={block.props.cta}
            onChange={(cta) => onPatch({ cta })}
            brand={brand}
          />
          <ColorField
            brandFallback={brand.colors.surface}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
          <ColorField
            brandFallback={brand.colors.text}
            label="Text colour"
            onChange={(v) => onPatch({ textColor: v })}
            value={block.props.textColor}
          />
        </>
      );

    case 'banner':
      return (
        <>
          <ImageField label="Banner artwork" image={block.props.image} onChange={(image) => onPatch({ image })} />
          <TextField
            hint="Leave empty for a non-clickable banner."
            label="Link destination"
            maxLength={2048}
            value={block.props.url}
            onChange={(v) => onPatch({ url: v })}
          />
          <NumberField label="Height (px)" max={800} min={60} value={block.props.height} onChange={(v) => onPatch({ height: v })} />
          <ColorField
            brandFallback={brand.colors.background}
            label="Fallback colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
            hint="Shown while the image loads and when images are blocked."
          />
        </>
      );

    case 'video':
      return (
        <>
          <ImageField
            label="Video thumbnail"
            image={block.props.thumbnail}
            onChange={(image) => onPatch({ thumbnail: image })}
          />
          <TextField
            hint="Email clients do not reliably play inline video, so the thumbnail links out to the video."
            label="Video URL"
            maxLength={2048}
            value={block.props.videoUrl}
            onChange={(v) => onPatch({ videoUrl: v })}
          />
          <TextField label="Title" value={block.props.title} onChange={(v) => onPatch({ title: v })} maxLength={200} />
          <TextAreaField label="Description" rows={3} value={block.props.description} onChange={(v) => onPatch({ description: v })} />
          <TextField label="Button label" value={block.props.ctaLabel} onChange={(v) => onPatch({ ctaLabel: v })} />
          <ToggleField
            checked={block.props.showPlayButton}
            label="Show play button overlay"
            onChange={(v) => onPatch({ showPlayButton: v })}
          />
        </>
      );

    case 'products':
      return (
        <>
          <ColumnsField max={4} onChange={(v) => onPatch({ columns: v })} value={block.props.columns} />
          <ToggleField checked={block.props.showPrice} label="Show prices" onChange={(v) => onPatch({ showPrice: v })} />
          <ProductListEditor
            items={block.props.items}
            onChange={(items) => onPatch({ items })}
            disabled={disabled}
          />
          <ColorField
            brandFallback={brand.colors.surface}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
        </>
      );

    case 'gallery':
      return (
        <>
          <ColumnsField max={4} onChange={(v) => onPatch({ columns: v })} value={block.props.columns} />
          <GalleryListEditor
            items={block.props.items}
            onChange={(items) => onPatch({ items })}
            disabled={disabled}
          />
          <ColorField
            brandFallback={brand.colors.surface}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
        </>
      );

    case 'promo':
      return (
        <>
          <TextField label="Badge" value={block.props.badge} onChange={(v) => onPatch({ badge: v })} maxLength={60} />
          <TextField label="Eyebrow" value={block.props.eyebrow} onChange={(v) => onPatch({ eyebrow: v })} maxLength={120} />
          <TextField label="Headline" value={block.props.headline} onChange={(v) => onPatch({ headline: v })} maxLength={200} />
          <TextAreaField label="Description" rows={3} value={block.props.description} onChange={(v) => onPatch({ description: v })} />
          <ImageField label="Image" image={block.props.image} onChange={(image) => onPatch({ image })} />
          <CtaEditor cta={block.props.cta} onChange={(cta) => onPatch({ cta })} brand={brand} />
          <ColorField
            brandFallback={brand.colors.primary}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
          <ColorField
            brandFallback="#ffffff"
            label="Text colour"
            onChange={(v) => onPatch({ textColor: v })}
            value={block.props.textColor}
          />
        </>
      );

    case 'text':
      return <TextBlockEditor block={block} onPatch={onPatch} brand={brand} />;

    case 'button':
      return (
        <>
          <TextField label="Label" value={block.props.label} onChange={(v) => onPatch({ label: v })} maxLength={120} />
          <TextField
            hint="Required: a button without a destination is reported as a blocking issue."
            label="Destination URL"
            maxLength={2048}
            value={block.props.url}
            onChange={(v) => onPatch({ url: v })}
          />
          <ColorField
            brandFallback={brand.colors.buttonBackground}
            label="Button colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
          <ColorField
            brandFallback={brand.colors.buttonText}
            label="Label colour"
            onChange={(v) => onPatch({ textColor: v })}
            value={block.props.textColor}
          />
          <NumberField label="Corner radius (px)" max={40} min={0} value={block.props.radius} onChange={(v) => onPatch({ radius: v })} />
          <AlignmentField value={block.props.align} onChange={(v) => onPatch({ align: v })} />
          <ToggleField checked={block.props.fullWidth} label="Full width" onChange={(v) => onPatch({ fullWidth: v })} />
        </>
      );

    case 'social':
      return (
        <>
          <SocialListEditor links={block.props.links} onChange={(links) => onPatch({ links })} disabled={disabled} />
          <AlignmentField value={block.props.align} onChange={(v) => onPatch({ align: v })} />
          <ColorField
            brandFallback={brand.colors.primary}
            label="Icon colour"
            onChange={(v) => onPatch({ iconColor: v })}
            value={block.props.iconColor}
          />
          <NumberField label="Icon size (px)" max={48} min={16} value={block.props.size} onChange={(v) => onPatch({ size: v })} />
        </>
      );

    case 'spacer':
      return (
        <>
          <NumberField label="Height (px)" max={200} min={4} value={block.props.height} onChange={(v) => onPatch({ height: v })} />
          <ColorField
            brandFallback={brand.colors.surface}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
        </>
      );

    case 'divider':
      return (
        <>
          <ColorField
            brandFallback={brand.colors.background}
            label="Line colour"
            onChange={(v) => onPatch({ color: v })}
            value={block.props.color}
          />
          <NumberField label="Thickness (px)" max={8} min={1} value={block.props.thickness} onChange={(v) => onPatch({ thickness: v })} />
          <NumberField label="Width (%)" max={100} min={20} value={block.props.width} onChange={(v) => onPatch({ width: v })} />
        </>
      );

    case 'background':
      return (
        <>
          <TextField label="Heading" value={block.props.heading} onChange={(v) => onPatch({ heading: v })} maxLength={200} />
          <TextAreaField label="Text" rows={3} value={block.props.text} onChange={(v) => onPatch({ text: v })} />
          <ImageField label="Background image" image={block.props.image} onChange={(image) => onPatch({ image })} />
          <ColorField
            brandFallback={brand.colors.background}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
          <ColorField
            brandFallback={brand.colors.text}
            label="Text colour"
            onChange={(v) => onPatch({ textColor: v })}
            value={block.props.textColor}
          />
          <NumberField label="Padding (px)" max={80} min={0} value={block.props.padding} onChange={(v) => onPatch({ padding: v })} />
        </>
      );

    case 'footer':
      return (
        <>
          <TextField label="Company name" value={block.props.companyName} onChange={(v) => onPatch({ companyName: v })} />
          <TextAreaField label="Address" rows={2} value={block.props.addressLine} onChange={(v) => onPatch({ addressLine: v })} />
          <TextField label="Contact email" value={block.props.contactEmail} onChange={(v) => onPatch({ contactEmail: v })} />
          <TextField label="Contact phone" value={block.props.contactPhone} onChange={(v) => onPatch({ contactPhone: v })} />
          <TextField
            hint="Required for marketing email: recipients must be able to change their preferences."
            label="Preferences URL"
            maxLength={2048}
            value={block.props.preferencesUrl}
            onChange={(v) => onPatch({ preferencesUrl: v })}
          />
          <TextField
            hint="Required: an email without a working opt-out fails validation."
            label="Unsubscribe URL"
            maxLength={2048}
            value={block.props.unsubscribeUrl}
            onChange={(v) => onPatch({ unsubscribeUrl: v })}
          />
          <TextField
            label="Unsubscribe label"
            value={block.props.unsubscribeLabel}
            onChange={(v) => onPatch({ unsubscribeLabel: v })}
          />
          <TextAreaField label="Legal text" rows={2} value={block.props.legalText} onChange={(v) => onPatch({ legalText: v })} />
          <ToggleField checked={block.props.showSocial} label="Show social icons" onChange={(v) => onPatch({ showSocial: v })} />
          {block.props.showSocial ? (
            <SocialListEditor links={block.props.socialLinks} onChange={(links) => onPatch({ socialLinks: links })} disabled={disabled} />
          ) : null}
          <ColorField
            brandFallback={brand.colors.secondary}
            label="Background colour"
            onChange={(v) => onPatch({ backgroundColor: v })}
            value={block.props.backgroundColor}
          />
          <ColorField
            brandFallback="#ffffff"
            label="Text colour"
            onChange={(v) => onPatch({ textColor: v })}
            value={block.props.textColor}
          />
        </>
      );

    default:
      return (
        <p className="text-xs text-slate-400">
          This block has no editable properties.{' '}
          <button className="underline" type="button" onClick={() => onReplaceBlock(block)}>
            Reset
          </button>
        </p>
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Text block                                                                  */
/* -------------------------------------------------------------------------- */

function TextBlockEditor({
  block,
  onPatch,
  brand,
}: {
  block: Extract<EmailBlock, { type: 'text' }>;
  onPatch: (patch: Record<string, unknown>) => void;
  brand: EmailBrandTokens;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'visual' | 'html'>('visual');

  function wrap(tag: string) {
    const element = textarea.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = block.props.html.slice(start, end) || 'text';
    const next = `${block.props.html.slice(0, start)}<${tag}>${selected}</${tag}>${block.props.html.slice(end)}`;
    onPatch({ html: next });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + tag.length + 2, start + tag.length + 2 + selected.length);
    });
  }

  function insertLink() {
    const element = textarea.current;
    if (!element) return;
    const url = window.prompt('Link URL (https://…)', 'https://example.com');
    if (!url) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = block.props.html.slice(start, end) || 'link text';
    const next = `${block.props.html.slice(0, start)}<a href="${url}">${selected}</a>${block.props.html.slice(end)}`;
    onPatch({ html: next });
  }

  return (
    <>
      <TextField label="Heading" value={block.props.heading} onChange={(v) => onPatch({ heading: v })} maxLength={200} />
      <SelectField<'1' | '2' | '3'>
        label="Heading level"
        onChange={(v) => onPatch({ headingLevel: Number(v) as 1 | 2 | 3 })}
        options={[
          { value: '1', label: 'H1' },
          { value: '2', label: 'H2' },
          { value: '3', label: 'H3' },
        ]}
        value={String(block.props.headingLevel) as '1' | '2' | '3'}
      />
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-300">Body</span>
          <div className="flex gap-1">
            <button
              className={`btn-ghost px-2 py-0.5 text-[11px] ${mode === 'visual' ? 'bg-surface-raised' : ''}`}
              type="button"
              onClick={() => setMode('visual')}
            >
              Formatted
            </button>
            <button
              className={`btn-ghost px-2 py-0.5 text-[11px] ${mode === 'html' ? 'bg-surface-raised' : ''}`}
              type="button"
              onClick={() => setMode('html')}
            >
              HTML
            </button>
          </div>
        </div>
        {mode === 'visual' ? (
          <div className="panel-subtle p-3">
            <div
              className="prose-invert max-w-none text-sm leading-6 text-slate-200"
              // The rendered text is sanitised server-side before it is used.
              dangerouslySetInnerHTML={{ __html: sanitizePreview(block.props.html) }}
            />
          </div>
        ) : (
          <textarea
            className="input font-mono text-xs"
            ref={textarea}
            rows={8}
            value={block.props.html}
            onChange={(event) => onPatch({ html: event.target.value })}
          />
        )}
        <div className="flex flex-wrap gap-1 pt-1">
          <button className="btn-ghost px-2 py-0.5 text-[11px]" type="button" onClick={() => wrap('strong')}>
            Bold
          </button>
          <button className="btn-ghost px-2 py-0.5 text-[11px]" type="button" onClick={() => wrap('em')}>
            Italic
          </button>
          <button className="btn-ghost px-2 py-0.5 text-[11px]" type="button" onClick={() => wrap('u')}>
            Underline
          </button>
          <button className="btn-ghost px-2 py-0.5 text-[11px]" type="button" onClick={insertLink}>
            Link
          </button>
          <button className="btn-ghost px-2 py-0.5 text-[11px]" type="button" onClick={() => wrap('li')}>
            List item
          </button>
        </div>
        <p className="text-[11px] leading-4 text-slate-500">{RICH_TEXT_HINT}</p>
      </div>
      <AlignmentField value={block.props.alignment} onChange={(v) => onPatch({ alignment: v })} />
      <NumberField
        label="Font size (px)"
        max={24}
        min={11}
        value={block.props.fontSize}
        onChange={(v) => onPatch({ fontSize: v })}
      />
      <ColorField
        brandFallback={brand.colors.text}
        label="Text colour"
        onChange={(v) => onPatch({ color: v })}
        value={block.props.color}
      />
    </>
  );
}

/** Local preview sanitisation so the panel never shows raw markup. */
function sanitizePreview(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

/* -------------------------------------------------------------------------- */
/* List editors                                                                */
/* -------------------------------------------------------------------------- */

function CtaEditor({
  cta,
  onChange,
  brand,
}: {
  cta: { label: string; url: string } | null;
  onChange: (cta: { label: string; url: string } | null) => void;
  brand: EmailBrandTokens;
}) {
  if (!cta) {
    return (
      <button className="btn-secondary w-full justify-center text-xs" type="button" onClick={() => onChange({ label: 'Learn more', url: 'https://example.com' })}>
        Add a call-to-action button
      </button>
    );
  }
  return (
    <div className="panel-subtle space-y-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">Call to action</p>
        <button className="btn-ghost px-2 py-0.5 text-[11px] text-red-200" type="button" onClick={() => onChange(null)}>
          Remove
        </button>
      </div>
      <TextField label="Button label" value={cta.label} onChange={(v) => onChange({ ...cta, label: v })} maxLength={120} />
      <TextField label="Destination URL" maxLength={2048} value={cta.url} onChange={(v) => onChange({ ...cta, url: v })} />
      <p className="text-[11px] text-slate-500">
        Button colour comes from the brand ({brand.colors.buttonBackground}) and can be changed in Brand settings.
      </p>
    </div>
  );
}

function LinkListEditor({
  links,
  onChange,
  label,
  disabled,
}: {
  links: Array<{ label: string; url: string }>;
  onChange: (links: Array<{ label: string; url: string }>) => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">{label}</p>
        <button
          className="btn-ghost px-2 py-0.5 text-[11px]"
          disabled={disabled}
          type="button"
          onClick={() => onChange([...links, { label: 'New link', url: 'https://example.com' }])}
        >
          Add link
        </button>
      </div>
      {links.map((link, index) => (
        <div className="panel-subtle space-y-2 p-2" key={index}>
          <div className="flex gap-2">
            <input
              className="input py-1.5 text-xs"
              placeholder="Label"
              value={link.label}
              onChange={(event) => {
                const next = [...links];
                next[index] = { ...link, label: event.target.value };
                onChange(next);
              }}
            />
            <button
              className="btn-ghost px-2 py-1 text-[11px] text-red-200"
              type="button"
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <input
            className="input py-1.5 text-xs"
            placeholder="https://…"
            value={link.url}
            onChange={(event) => {
              const next = [...links];
              next[index] = { ...link, url: event.target.value };
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function SocialListEditor({
  links,
  onChange,
  disabled,
}: {
  links: Array<{ platform: EmailSocialPlatform; url: string }>;
  onChange: (links: Array<{ platform: EmailSocialPlatform; url: string }>) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">Social links</p>
        <button
          className="btn-ghost px-2 py-0.5 text-[11px]"
          disabled={disabled}
          type="button"
          onClick={() =>
            onChange([...links, { platform: 'linkedin', url: 'https://www.linkedin.com/company/example' }])
          }
        >
          Add platform
        </button>
      </div>
      {links.map((link, index) => (
        <div className="panel-subtle space-y-2 p-2" key={index}>
          <div className="flex gap-2">
            <select
              className="input py-1.5 text-xs"
              value={link.platform}
              onChange={(event) => {
                const next = [...links];
                next[index] = { ...link, platform: event.target.value as EmailSocialPlatform };
                onChange(next);
              }}
            >
              {EMAIL_SOCIAL_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
            <button
              className="btn-ghost px-2 py-1 text-[11px] text-red-200"
              type="button"
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <input
            className="input py-1.5 text-xs"
            placeholder="https://…"
            value={link.url}
            onChange={(event) => {
              const next = [...links];
              next[index] = { ...link, url: event.target.value };
              onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function ProductListEditor({
  items,
  onChange,
  disabled,
}: {
  items: EmailProductCard[];
  onChange: (items: EmailProductCard[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">Products ({items.length})</p>
        <button
          className="btn-ghost px-2 py-0.5 text-[11px]"
          disabled={disabled}
          type="button"
          onClick={() =>
            onChange([
              ...items,
              {
                id: createBlockId('item'),
                image: { mediaId: null, url: null, alt: 'Product image' },
                title: 'New product',
                description: '',
                price: '',
                url: 'https://example.com/product',
                ctaLabel: 'View product',
              },
            ])
          }
        >
          Add product
        </button>
      </div>
      {items.map((item, index) => (
        <div className="panel-subtle space-y-2 p-3" key={item.id}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Product {index + 1}</p>
            <button
              className="btn-ghost px-2 py-0.5 text-[11px] text-red-200"
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <ImageField label="Product image" image={item.image} onChange={(image) => {
            const next = [...items];
            next[index] = { ...item, image };
            onChange(next);
          }} />
          <TextField label="Title" value={item.title} maxLength={200} onChange={(v) => {
            const next = [...items];
            next[index] = { ...item, title: v };
            onChange(next);
          }} />
          <TextAreaField label="Description" rows={2} maxLength={600} value={item.description} onChange={(v) => {
            const next = [...items];
            next[index] = { ...item, description: v };
            onChange(next);
          }} />
          <TextField label="Price" maxLength={60} value={item.price} onChange={(v) => {
            const next = [...items];
            next[index] = { ...item, price: v };
            onChange(next);
          }} />
          <TextField label="Link URL" maxLength={2048} value={item.url} onChange={(v) => {
            const next = [...items];
            next[index] = { ...item, url: v };
            onChange(next);
          }} />
          <TextField label="Button label" value={item.ctaLabel} onChange={(v) => {
            const next = [...items];
            next[index] = { ...item, ctaLabel: v };
            onChange(next);
          }} />
        </div>
      ))}
    </div>
  );
}

function GalleryListEditor({
  items,
  onChange,
  disabled,
}: {
  items: EmailGalleryItem[];
  onChange: (items: EmailGalleryItem[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">Items ({items.length})</p>
        <button
          className="btn-ghost px-2 py-0.5 text-[11px]"
          disabled={disabled}
          type="button"
          onClick={() =>
            onChange([
              ...items,
              {
                id: createBlockId('item'),
                image: { mediaId: null, url: null, alt: 'Gallery image' },
                title: 'New item',
                url: 'https://example.com/item',
              },
            ])
          }
        >
          Add item
        </button>
      </div>
      {items.map((item, index) => (
        <div className="panel-subtle space-y-2 p-3" key={item.id}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Item {index + 1}</p>
            <button
              className="btn-ghost px-2 py-0.5 text-[11px] text-red-200"
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
          <ImageField label="Image" image={item.image} onChange={(image) => {
            const next = [...items];
            next[index] = { ...item, image };
            onChange(next);
          }} />
          <TextField label="Caption" value={item.title} maxLength={200} onChange={(v) => {
            const next = [...items];
            next[index] = { ...item, title: v };
            onChange(next);
          }} />
          <TextField label="Link URL" maxLength={2048} value={item.url} onChange={(v) => {
            const next = [...items];
            next[index] = { ...item, url: v };
            onChange(next);
          }} />
        </div>
      ))}
    </div>
  );
}
