'use client';

// The bridge between the metadata layer (field_def.type + config) and the UI.
// Given a field definition, FieldInput renders the right *masked* control for
// create/edit, and FieldValue renders the right formatter for detail/list/read.
// One registry, used everywhere a dynamic field appears.

import type { FieldConfig, FieldType } from '@northbeam/db/field-types';
import type { ReactNode } from 'react';
import { CurrencyInput, EmailInput, MaskedInput, PhoneInput, TextInput } from '../ui/input';
import { Combobox, type Option, Select } from '../ui/select';
import { Icon } from './icons';

export type FieldDefLite = {
  key: string;
  label: string;
  type: FieldType;
  config?: FieldConfig;
  required?: boolean;
};

const READONLY: FieldType[] = ['autonumber', 'formula', 'rollup', 'ai'];

/* ── create / edit input (masked per type) ─────────────────────────────────── */
export function FieldInput({
  field,
  value,
  onChange,
  loadReference,
  referenceValue,
}: {
  field: FieldDefLite;
  value: unknown;
  onChange: (v: unknown) => void;
  /** for `reference` fields: searches records of the target object */
  loadReference?: (q: string) => Promise<Option[]>;
  /** for `reference` fields: the currently-selected option (id + label) */
  referenceValue?: Option | null;
}) {
  const cfg: FieldConfig = field.config ?? {};
  const str = value == null ? '' : String(value);

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          className="bare"
          rows={3}
          value={str}
          placeholder={cfg.helpText}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'email':
      return <EmailInput value={str} onChange={onChange} />;
    case 'phone':
      return <PhoneInput value={str} onChange={onChange} />;
    case 'url':
      return (
        <TextInput
          type="url"
          leadIcon="link-simple"
          placeholder="https://"
          value={str}
          onChange={onChange}
        />
      );
    case 'number':
      return (
        <TextInput
          inputMode="numeric"
          value={str}
          onChange={(v) => onChange(v === '' ? null : Number(v.replace(/[^\d.-]/g, '')))}
        />
      );
    case 'currency':
      return (
        <CurrencyInput
          value={str}
          code={cfg.currencyCode ?? 'USD'}
          onChange={(v) => onChange(v === '' ? null : Number(v.replace(/,/g, '')))}
        />
      );
    case 'percent':
      return (
        <TextInput
          inputMode="decimal"
          trailAffix="%"
          value={str}
          onChange={(v) => onChange(v === '' ? null : Number(v.replace(/[^\d.]/g, '')))}
        />
      );
    case 'date':
      return (
        <MaskedInput
          mask="99/99/9999"
          leadIcon="calendar-blank"
          placeholder="MM/DD/YYYY"
          value={str}
          onChange={onChange}
        />
      );
    case 'datetime':
      return (
        <MaskedInput
          mask="99/99/9999 99:99"
          leadIcon="clock"
          placeholder="MM/DD/YYYY HH:MM"
          value={str}
          onChange={onChange}
        />
      );
    case 'checkbox':
      return (
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
          style={{
            width: 38,
            height: 22,
            borderRadius: 99,
            border: 'none',
            cursor: 'pointer',
            background: value ? 'var(--brand)' : 'var(--surface-active)',
            position: 'relative',
            transition: 'background .15s',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: value ? 18 : 2,
              width: 18,
              height: 18,
              borderRadius: 99,
              background: '#fff',
              boxShadow: 'var(--shadow-xs)',
              transition: 'left .15s',
            }}
          />
        </button>
      );
    case 'picklist':
      return (
        <Select
          value={str}
          onChange={onChange}
          placeholder="Select…"
          options={(cfg.options ?? []).map((o) => ({
            value: o.value,
            label: o.label,
            color: o.color,
          }))}
        />
      );
    case 'multipicklist':
      return (
        <div className="row row--tight">
          {(cfg.options ?? []).map((o) => {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            const on = arr.includes(o.value);
            return (
              <button
                type="button"
                key={o.value}
                className="chip"
                onClick={() => onChange(on ? arr.filter((v) => v !== o.value) : [...arr, o.value])}
                style={{
                  cursor: 'pointer',
                  background: on
                    ? 'color-mix(in srgb, var(--brand) 14%, var(--surface))'
                    : 'var(--surface-active)',
                  color: on ? 'var(--brand)' : 'var(--ink-muted)',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
    case 'reference':
      return (
        <Combobox
          value={referenceValue ?? null}
          onChange={(o) => onChange(o?.value ?? null)}
          loadOptions={loadReference ?? (async () => [])}
          placeholder={`Search ${cfg.targetObject ?? 'records'}…`}
          emptyText="No matches"
        />
      );
    default:
      // text + read-only computed types (autonumber/formula/rollup/ai)
      return (
        <TextInput
          value={str}
          onChange={onChange}
          disabled={READONLY.includes(field.type)}
          leadIcon={READONLY.includes(field.type) ? 'function' : undefined}
        />
      );
  }
}

/* ── read display (formatted per type) ──────────────────────────────────────── */
export function FieldValue({
  field,
  value,
  referenceLabel,
}: {
  field: FieldDefLite;
  value: unknown;
  referenceLabel?: string;
}): ReactNode {
  const cfg: FieldConfig = field.config ?? {};
  if (value == null || value === '') return <span style={{ color: 'var(--ink-subtle)' }}>—</span>;

  switch (field.type) {
    case 'currency': {
      const n = Number(value);
      return (
        <span className="num">
          {new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: cfg.currencyCode ?? 'USD',
            maximumFractionDigits: 0,
          }).format(n)}
        </span>
      );
    }
    case 'percent':
      return <span className="num">{Number(value)}%</span>;
    case 'number':
      return <span className="num">{Number(value).toLocaleString('en-US')}</span>;
    case 'checkbox':
      return value ? (
        <Icon name="check-circle" size={16} />
      ) : (
        <span style={{ color: 'var(--ink-subtle)' }}>—</span>
      );
    case 'email':
      return (
        <a href={`mailto:${value}`} style={{ color: 'var(--brand)' }}>
          {String(value)}
        </a>
      );
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)' }}>
          {String(value)}
        </a>
      );
    case 'picklist': {
      const opt = (cfg.options ?? []).find((o) => o.value === value);
      return (
        <span
          className="chip"
          style={
            opt?.color
              ? {
                  color: opt.color,
                  background: `color-mix(in srgb, ${opt.color} 14%, var(--surface))`,
                }
              : undefined
          }
        >
          {opt?.label ?? String(value)}
        </span>
      );
    }
    case 'multipicklist': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          {arr.map((v) => {
            const opt = (cfg.options ?? []).find((o) => o.value === v);
            return (
              <span className="chip" key={v}>
                {opt?.label ?? v}
              </span>
            );
          })}
        </span>
      );
    }
    case 'reference':
      return <span>{referenceLabel ?? String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}
