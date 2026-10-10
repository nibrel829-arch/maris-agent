'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/primitives';
import type { EmailBrandProfile } from '@/types/email-design';
import { AssetPicker } from './studio/AssetPicker';
import { ColorField, Field, NumberField, TextAreaField, TextField, ToggleField } from './studio/fields';
import { emailSocialPlatformList } from './studio/social-platforms';

/**
 * Organization brand + design system form (Phase 16 §4).
 *
 * Owner/admin only (enforced server-side as well). Everything saved here seeds
 * new blocks and can be applied to an existing design from the studio toolbar.
 */

interface Props {
  profile: EmailBrandProfile;
  canManage: boolean;
  recordId: string | null;
}

const COLOR_FIELDS: Array<{ key: keyof EmailBrandProfile['colors']; label: string }> = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Page background' },
  { key: 'surface', label: 'Card surface' },
  { key: 'text', label: 'Body text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'link', label: 'Links' },
  { key: 'buttonBackground', label: 'Button background' },
  { key: 'buttonText', label: 'Button text' },
];

export function BrandSettingsForm({ profile, canManage, recordId }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<EmailBrandProfile>(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setForm(profile), [profile]);

  function update<K extends keyof EmailBrandProfile>(key: K, value: EmailBrandProfile[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/workspace/email/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: form.brandName,
          logo: form.logo,
          colors: form.colors,
          typography: form.typography,
          button: form.button,
          headerDefaults: form.headerDefaults,
          footerDefaults: form.footerDefaults,
        }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        setError(payload.error?.message ?? 'Could not save the brand profile.');
        return;
      }
      setNotice('Brand profile saved. New blocks and the “Apply brand defaults” action use these values.');
      router.refresh();
    } catch {
      setError('Could not reach the server to save the brand profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" noValidate onSubmit={save}>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="card-title">Identity</h2>
            <Badge tone={recordId ? 'success' : 'warning'}>{recordId ? 'Saved' : 'Not saved yet'}</Badge>
          </div>
          <TextField label="Brand name" maxLength={120} value={form.brandName} onChange={(v) => update('brandName', v)} />
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-300">Logo</p>
            <AssetPicker label="Brand logo" onChange={(image) => update("logo", image)} value={form.logo} />
            <p className="text-[11px] leading-4 text-slate-500">
              The logo is referenced by Content Library media id. Bytes stay in the private bucket and are delivered
              through signed, expiring URLs.
            </p>
          </div>
        </section>

        <section className="panel space-y-4 p-5">
          <h2 className="card-title">Colours</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {COLOR_FIELDS.map((field) => (
              <ColorField
                brandFallback="#2b5cff"
                key={field.key}
                label={field.label}
                onChange={(value) => update('colors', { ...form.colors, [field.key]: value ?? '#2b5cff' })}
                value={form.colors[field.key]}
              />
            ))}
          </div>
        </section>

        <section className="panel space-y-4 p-5">
          <h2 className="card-title">Typography & buttons</h2>
          <TextField
            hint="Comma-separated web-safe stack. No web fonts are loaded inside an email."
            label="Heading font"
            maxLength={160}
            value={form.typography.headingFont}
            onChange={(v) => update('typography', { ...form.typography, headingFont: v })}
          />
          <TextField
            label="Body font"
            maxLength={160}
            value={form.typography.bodyFont}
            onChange={(v) => update('typography', { ...form.typography, bodyFont: v })}
          />
          <NumberField
            label="Base font size (px)"
            max={20}
            min={12}
            value={form.typography.baseSize}
            onChange={(v) => update('typography', { ...form.typography, baseSize: v })}
          />
          <NumberField
            label="Button corner radius (px)"
            max={40}
            min={0}
            value={form.button.radius}
            onChange={(v) => update('button', { ...form.button, radius: v })}
          />
          <ToggleField
            checked={form.button.uppercase}
            label="Uppercase button labels"
            onChange={(v) => update('button', { ...form.button, uppercase: v })}
          />
          <Field label="Button label weight">
            <select
              className="input"
              value={form.button.fontWeight}
              onChange={(event) => update('button', { ...form.button, fontWeight: event.target.value as 'normal' | 'bold' })}
            >
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
            </select>
          </Field>
        </section>

        <section className="panel space-y-4 p-5">
          <h2 className="card-title">Header defaults</h2>
          <TextField
            label="Header brand name"
            maxLength={120}
            value={form.headerDefaults.brandName}
            onChange={(v) => update('headerDefaults', { ...form.headerDefaults, brandName: v })}
          />
          <ToggleField
            checked={form.headerDefaults.showNav}
            label="Show navigation links by default"
            onChange={(v) => update('headerDefaults', { ...form.headerDefaults, showNav: v })}
          />
          <p className="text-[11px] leading-4 text-slate-500">
            Navigation links are set per design in the studio. Logo comes from the identity section above.
          </p>
        </section>

        <section className="panel space-y-4 p-5 xl:col-span-2">
          <h2 className="card-title">Footer defaults</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Company name"
              maxLength={160}
              value={form.footerDefaults.companyName}
              onChange={(v) => update('footerDefaults', { ...form.footerDefaults, companyName: v })}
            />
            <TextField
              label="Contact email"
              maxLength={160}
              value={form.footerDefaults.contactEmail}
              onChange={(v) => update('footerDefaults', { ...form.footerDefaults, contactEmail: v })}
            />
            <TextField
              label="Contact phone"
              maxLength={60}
              value={form.footerDefaults.contactPhone}
              onChange={(v) => update('footerDefaults', { ...form.footerDefaults, contactPhone: v })}
            />
            <TextField
              hint="Where recipients change what they receive from you."
              label="Preferences URL"
              maxLength={2048}
              value={form.footerDefaults.preferencesUrl}
              onChange={(v) => update('footerDefaults', { ...form.footerDefaults, preferencesUrl: v })}
            />
            <TextField
              hint="Required for marketing email. Validation blocks a test send without it."
              label="Unsubscribe URL"
              maxLength={2048}
              value={form.footerDefaults.unsubscribeUrl}
              onChange={(v) => update('footerDefaults', { ...form.footerDefaults, unsubscribeUrl: v })}
            />
          </div>
          <TextAreaField
            label="Address"
            rows={2}
            value={form.footerDefaults.addressLine}
            onChange={(v) => update('footerDefaults', { ...form.footerDefaults, addressLine: v })}
          />
          <TextAreaField
            label="Legal text"
            rows={2}
            value={form.footerDefaults.legalText}
            onChange={(v) => update('footerDefaults', { ...form.footerDefaults, legalText: v })}
          />
          <p className="text-[11px] leading-4 text-slate-500">
            Footer social links are configured per design in the studio, so each campaign can use the right accounts.
          </p>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!canManage || saving} type="submit">
          {saving ? 'Saving…' : 'Save brand profile'}
        </button>
        {!canManage ? (
          <p className="text-xs leading-5 text-amber-200">
            Brand configuration is organization-wide and requires an owner or admin role with email:edit.
          </p>
        ) : null}
        {notice ? <p className="text-xs leading-5 text-emerald-200">{notice}</p> : null}
        {error ? <p className="text-xs leading-5 text-red-200">{error}</p> : null}
      </div>

      <p className="text-[11px] leading-4 text-slate-600">
        Supported social platforms: {emailSocialPlatformList().join(', ')}.
      </p>
    </form>
  );
}
