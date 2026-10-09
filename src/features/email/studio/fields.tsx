'use client';

import type { ReactNode } from 'react';
import type { EmailAlignment, EmailImage } from '@/types/email-design';
import { AssetPicker } from './AssetPicker';

/** Shared form controls for the studio properties panel. */

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-300" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] leading-4 text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength = 300,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        className="input"
        id={id}
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength = 20000,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <textarea
        className="input font-mono text-xs"
        id={id}
        maxLength={maxLength}
        placeholder={placeholder}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 800,
  step = 1,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        className="input"
        id={id}
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => {
          const next = Number.parseInt(event.target.value, 10);
          onChange(Number.isFinite(next) ? next : min);
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select className="input" id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex items-start justify-between gap-3">
      <label className="text-xs font-medium text-slate-300" htmlFor={id}>
        {label}
        {hint ? <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{hint}</span> : null}
      </label>
      <input
        checked={checked}
        className="mt-0.5 h-4 w-4"
        id={id}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function ColorField({
  label,
  value,
  onChange,
  brandFallback,
  hint,
}: {
  label: string;
  /** null means "inherit from the brand". */
  value: string | null;
  onChange: (value: string | null) => void;
  brandFallback: string;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const current = value ?? brandFallback;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-slate-300" htmlFor={id}>
          {label}
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            checked={value === null}
            className="h-3.5 w-3.5"
            type="checkbox"
            onChange={(event) => onChange(event.target.checked ? null : brandFallback)}
          />
          Use brand colour
        </label>
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label={`${label} colour picker`}
          className="h-9 w-12 rounded-lg border border-surface-border bg-transparent p-1"
          disabled={value === null}
          type="color"
          value={HEX.test(current) ? current : '#2b5cff'}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className="input font-mono text-xs"
          disabled={value === null}
          id={id}
          maxLength={32}
          value={current}
          onChange={(event) => {
            const next = event.target.value.trim();
            onChange(next.length > 0 ? next : brandFallback);
          }}
        />
      </div>
      {hint ? <p className="text-[11px] leading-4 text-slate-500">{hint}</p> : null}
      {value !== null && !HEX.test(value) ? (
        <p className="text-[11px] leading-4 text-amber-200">Use a hex colour such as #2b5cff.</p>
      ) : null}
    </div>
  );
}

export function ImageField({
  label,
  image,
  onChange,
  hint,
}: {
  label: string;
  image: EmailImage;
  onChange: (image: EmailImage) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-slate-300">{label}</p>
      <AssetPicker label={label} onChange={onChange} value={image} />
      {hint ? <p className="text-[11px] leading-4 text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function AlignmentField({
  value,
  onChange,
}: {
  value: EmailAlignment;
  onChange: (value: EmailAlignment) => void;
}) {
  return (
    <SelectField<EmailAlignment>
      label="Alignment"
      onChange={onChange}
      options={[
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
      ]}
      value={value}
    />
  );
}

export function ColumnsField({
  value,
  onChange,
  max = 4,
}: {
  value: number;
  onChange: (value: 1 | 2 | 3 | 4) => void;
  max?: 2 | 3 | 4;
}) {
  const options = ([1, 2, 3, 4] as const)
    .filter((count) => count <= max)
    .map((count) => ({ value: count, label: `${count} column${count === 1 ? '' : 's'}` }));
  return (
    <SelectField<'1' | '2' | '3' | '4'>
      label="Columns"
      onChange={(value) => onChange(Number(value) as 1 | 2 | 3 | 4)}
      options={options.map((option) => ({ value: String(option.value) as '1' | '2' | '3' | '4', label: option.label }))}
      value={String(value) as '1' | '2' | '3' | '4'}
    />
  );
}
