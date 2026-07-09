'use client';

// The bridge between the metadata layer (field_def.type + config) and the UI.
// Given a field definition, FieldInput renders the right *masked* control for
// create/edit, and FieldValue renders the right formatter for detail/list/read.
// One registry, used everywhere a dynamic field appears.

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { MaskInput } from '@/components/ui/mask-input';
import { PhoneInput, PhoneInputCountrySelect, PhoneInputField } from '@/components/ui/phone-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type AddressValue,
  type FieldConfig,
  type FieldType,
  formatDurationMinutes,
} from '@northbeam/db/field-types';
import { Check, Link as LinkIcon, MapPin } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AddressInput, formatAddressOneLine } from './address-input';
import { DatePicker, formatLongDate } from './date-picker';
import { DateTimePicker } from './date-time-picker';
import { DurationInput } from './duration-input';
import { Icon } from './icons';
import { Combobox, type Option } from './select-legacy';

export type FieldDefLite = {
  key: string;
  label: string;
  type: FieldType;
  config?: FieldConfig;
  required?: boolean;
};

/** Computed field types — never user-editable, anywhere a field is written. */
export const READONLY_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'autonumber',
  'formula',
  'rollup',
  'ai',
]);

/** Format a phone number for read display. Accepts a few common storage forms:
 *  E.164-ish ("+14806696775"), bare digits ("14806696775" or "4806696775"), or
 *  any legacy masked string ("(480) 669-6775"). Special-cases NANP (+1)
 *  because that's the bulk of CRM phone numbers we see; everything else falls
 *  back to a digit-grouped international format. */
function formatPhoneForDisplay(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;

  // NANP: 11 digits starting with 1, OR 10 digits without a country code.
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  // International fallback: keep the leading + and group remaining digits in
  // chunks of 3 for readability.
  if (raw.trim().startsWith('+') || digits.length > 11) {
    const grouped = digits.replace(/(\d{3})(?=\d)/g, '$1 ');
    return `+${grouped}`;
  }
  return raw;
}

/* ── create / edit input (masked per type) ─────────────────────────────────── */
export function FieldInput({
  field,
  value,
  onChange,
  loadReference,
  referenceValue,
  onReferenceChange,
}: {
  field: FieldDefLite;
  value: unknown;
  onChange: (v: unknown) => void;
  /** for `reference` fields: searches records of the target object */
  loadReference?: (q: string) => Promise<Option[]>;
  /** for `reference` fields: the currently-selected option (id + label) */
  referenceValue?: Option | null;
  /** for `reference` fields: receives the selected Option (or null) so the
   *  caller can store the label for re-display alongside the raw id. When
   *  absent, FieldInput falls back to forwarding the id via `onChange`. */
  onReferenceChange?: (o: Option | null) => void;
}) {
  const cfg: FieldConfig = field.config ?? {};
  const str = value == null ? '' : String(value);

  switch (field.type) {
    case 'textarea':
      return (
        <Textarea
          rows={3}
          value={str}
          placeholder={cfg.placeholder ?? cfg.helpText}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'email':
      return (
        <Input
          type="email"
          value={str}
          placeholder={cfg.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'phone':
      return (
        <PhoneInput
          value={str}
          onValueChange={onChange}
          defaultCountry="US"
          placeholder={cfg.placeholder ?? '(555) 123-4567'}
        >
          <PhoneInputCountrySelect />
          <PhoneInputField />
        </PhoneInput>
      );
    case 'url':
      return (
        <InputGroup>
          <InputGroupAddon>
            <LinkIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="url"
            placeholder={cfg.placeholder ?? 'https://'}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        </InputGroup>
      );
    case 'number':
      return (
        <Input
          inputMode="numeric"
          value={str}
          placeholder={cfg.placeholder}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? null : Number(v.replace(/[^\d.-]/g, '')));
          }}
        />
      );
    case 'currency': {
      // The MaskInput currency mode injects the locale's currency symbol into
      // the displayed value (e.g. "$1,234.56") — so we DON'T render a leading
      // symbol addon (would duplicate). The trailing addon shows the ISO code
      // for clarity. When #16 lands, the trailing addon becomes a
      // CurrencyCombobox so users can change the currency per record.
      const code = cfg.currencyCode ?? 'USD';
      return (
        <InputGroup>
          <MaskInput
            asChild
            mask="currency"
            currency={code}
            // Strip MaskInput's own border/radius/bg/shadow when nested inside
            // InputGroup — InputGroup owns the wrapper styling. Otherwise we
            // get a double-bordered inner box.
            className="rounded-none border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0"
            value={str}
            placeholder={cfg.placeholder}
            onValueChange={(_masked, unmasked) =>
              onChange(unmasked === '' ? null : Number(unmasked))
            }
          >
            <InputGroupInput />
          </MaskInput>
          <InputGroupAddon align="inline-end" className="font-mono text-muted-foreground text-xs">
            {code}
          </InputGroupAddon>
        </InputGroup>
      );
    }
    case 'percent':
      return (
        <MaskInput
          mask="percentage"
          value={str}
          placeholder={cfg.placeholder}
          onValueChange={(_masked, unmasked) => onChange(unmasked === '' ? null : Number(unmasked))}
        />
      );
    case 'date':
      return (
        <DatePicker
          value={typeof value === 'string' ? value : null}
          onChange={onChange}
          placeholder={cfg.placeholder ?? 'Pick a date'}
        />
      );
    case 'datetime':
      return (
        <DateTimePicker
          value={typeof value === 'string' ? value : null}
          onChange={onChange}
          placeholder={cfg.placeholder ?? 'Pick a date'}
        />
      );
    case 'duration':
      return (
        <DurationInput
          value={typeof value === 'number' ? value : value == null ? null : Number(value)}
          onChange={onChange}
          placeholder={cfg.placeholder ?? 'e.g. 1h 30m'}
        />
      );
    case 'address':
      return (
        <AddressInput
          value={(value ?? null) as AddressValue | null}
          onChange={onChange}
          countries={cfg.countries}
        />
      );
    case 'checkbox':
      return (
        <Checkbox checked={!!value} onCheckedChange={(checked) => onChange(checked === true)} />
      );
    case 'picklist':
      return (
        <Select value={str} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={cfg.placeholder ?? 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {(cfg.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multipicklist':
      return (
        <div className="flex flex-wrap gap-1.5">
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
          onChange={(o) => {
            if (onReferenceChange) onReferenceChange(o);
            else onChange(o?.value ?? null);
          }}
          loadOptions={loadReference ?? (async () => [])}
          placeholder={cfg.placeholder ?? `Search ${cfg.targetObject ?? 'records'}…`}
          emptyText="No matches"
        />
      );
    default:
      // text + read-only computed types (autonumber/formula/rollup/ai)
      return (
        <Input
          value={str}
          placeholder={cfg.placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={READONLY_FIELD_TYPES.has(field.type)}
        />
      );
  }
}

/** Plain-text formatting for numeric/date field values. Shared between
 *  FieldValue and the data grid's cell variants (their `display` option) so a
 *  committed cell stays formatted when it isn't being edited. */
export function formatFieldValueText(field: FieldDefLite, value: unknown): string {
  const cfg: FieldConfig = field.config ?? {};
  if (value == null || value === '') return '';
  switch (field.type) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: cfg.currencyCode ?? 'USD',
        maximumFractionDigits: 0,
      }).format(Number(value));
    case 'percent':
      return `${Number(value)}%`;
    case 'number':
      return Number(value).toLocaleString('en-US');
    case 'date':
      return formatLongDate(String(value));
    case 'datetime': {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
    default:
      return String(value);
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
  if (value == null || value === '') return <span className="text-ink-subtle">—</span>;

  switch (field.type) {
    case 'currency':
      return <span className="tabular-nums">{formatFieldValueText(field, value)}</span>;
    case 'percent':
      return <span className="num">{formatFieldValueText(field, value)}</span>;
    case 'number':
      return <span className="num">{formatFieldValueText(field, value)}</span>;
    case 'checkbox':
      return value ? (
        <Check className="size-4 text-primary" />
      ) : (
        <span className="text-ink-subtle">—</span>
      );
    case 'email':
      return (
        <a href={`mailto:${value}`} className="text-primary">
          {String(value)}
        </a>
      );
    case 'phone': {
      const raw = String(value);
      return (
        <a href={`tel:${raw.replace(/[^\d+]/g, '')}`} className="tabular-nums">
          {formatPhoneForDisplay(raw)}
        </a>
      );
    }
    case 'url':
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="text-primary">
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
        <span className="inline-flex flex-wrap gap-1.5">
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
    case 'reference': {
      // The value IS the target record's id — always render it as navigation.
      // stopPropagation so links inside clickable list rows don't double-fire.
      const target = cfg.targetObject;
      const label = referenceLabel ?? String(value);
      if (!target) return <span>{label}</span>;
      return (
        <Link
          href={`/${target}/${String(value)}`}
          className="text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Link>
      );
    }
    case 'date':
    case 'datetime':
      return <span className="tabular-nums">{formatFieldValueText(field, value)}</span>;
    case 'duration': {
      const n = typeof value === 'number' ? value : Number(value);
      return (
        <span className="tabular-nums">
          {formatDurationMinutes(Number.isFinite(n) ? n : null) || '—'}
        </span>
      );
    }
    case 'address': {
      const v = value as AddressValue;
      const line = formatAddressOneLine(v);
      const lat = v.coordinates?.lat;
      const lng = v.coordinates?.lng;
      return (
        <span className="inline-flex items-start gap-1.5">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            {line || '—'}
            {lat != null && lng != null && (
              <a
                href={`https://www.google.com/maps?q=${lat},${lng}`}
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-primary text-xs"
              >
                map
              </a>
            )}
          </span>
        </span>
      );
    }
    default:
      return <span>{String(value)}</span>;
  }
}

// Silence "unused import" warning for icons barrel — kept here for callers
// that re-export FieldDefLite + Icon together.
export { Icon };
