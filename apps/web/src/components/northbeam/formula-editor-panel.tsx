'use client';

// Formula authoring panel — mono textarea with cursor-aware field insertion,
// function chips, and live client-side validation via the pure formula engine
// (@northbeam/db/formula). Modeled on the formula block in
// design_handoff_northbeam/studio-fieldeditor.jsx (AI generate box skipped).
//
// Validation here is parse-level + known-key checks only: unknown keys warn
// (amber) but never block, because related-record paths beyond the supplied
// one-hop refs can only be resolved server-side.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { Chip } from '@/components/ui/chip';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FieldType } from '@northbeam/db/field-types';
import {
  collectFieldKeys,
  parseFormula,
  supportedFunctionNames,
  validateFormula,
} from '@northbeam/db/formula';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

/** A related one-hop field path the formula can reference as `{ref.field}`. */
export type FormulaRefPath = { path: string; label: string; group: string };

/** Curated subset of engine functions surfaced as insert chips. Filtered
 *  against supportedFunctionNames() so a renamed engine fn can't drift. */
const CURATED_FNS = [
  'IF',
  'CASE',
  'ISBLANK',
  'BLANKVALUE',
  'ISPICKVAL',
  'ABS',
  'ROUND',
  'MIN',
  'MAX',
  'VALUE',
  'TEXT',
  'LEN',
  'CONCAT',
  'CONTAINS',
  'TRIM',
  'UPPER',
  'LOWER',
  'TODAY',
  'NOW',
  'DAYS',
];

const RETURN_TYPES: { value: FieldType; label: string }[] = [
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
  { value: 'text', label: 'Text' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
];

type Status =
  | { kind: 'idle' }
  | { kind: 'valid' }
  | { kind: 'error'; message: string }
  | { kind: 'warning'; message: string };

export function FormulaEditorPanel({
  fields,
  refPaths,
  formula,
  onChange,
  returnType,
  onReturnTypeChange,
  showReturnType,
  disabled,
}: {
  /** Same-record fields, insertable as `{key}`. */
  fields: FieldDefLite[];
  /** Related one-hop paths (`{ref.field}`), grouped by lookup label. */
  refPaths?: FormulaRefPath[];
  formula: string;
  onChange: (next: string) => void;
  returnType?: FieldType;
  onReturnTypeChange?: (next: FieldType) => void;
  showReturnType?: boolean;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const functionChips = useMemo(() => {
    const supported = supportedFunctionNames();
    return CURATED_FNS.filter((name) => supported.has(name));
  }, []);

  const refGroups = useMemo(() => {
    const groups = new Map<string, FormulaRefPath[]>();
    for (const ref of refPaths ?? []) {
      const list = groups.get(ref.group) ?? [];
      list.push(ref);
      groups.set(ref.group, list);
    }
    return [...groups.entries()];
  }, [refPaths]);

  // Debounced live validation (~200ms after the last keystroke).
  useEffect(() => {
    if (!formula.trim()) {
      setStatus({ kind: 'idle' });
      return;
    }
    const timer = setTimeout(() => {
      const result = validateFormula(formula);
      if (!result.ok) {
        setStatus({ kind: 'error', message: `${result.message} (at position ${result.pos})` });
        return;
      }
      const known = new Set([...fields.map((f) => f.key), ...(refPaths ?? []).map((r) => r.path)]);
      const unknown = [...collectFieldKeys(parseFormula(formula))].filter((k) => !known.has(k));
      if (unknown.length > 0) {
        const first = unknown[0] as string;
        const more = unknown.length > 1 ? ` (+${unknown.length - 1} more)` : '';
        setStatus({
          kind: 'warning',
          message: first.includes('.')
            ? `Can't verify related field {${first}} here${more} — it's checked on save.`
            : `Unknown field {${first}}${more}`,
        });
        return;
      }
      setStatus({ kind: 'valid' });
    }, 200);
    return () => clearTimeout(timer);
  }, [formula, fields, refPaths]);

  /** Insert at the caret, keeping focus + placing the caret after the insert
   *  (inside the parens for `FN()` inserts). */
  const insert = (text: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? formula.length;
    const end = el?.selectionEnd ?? formula.length;
    onChange(formula.slice(0, start) + text + formula.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + text.length - (text.endsWith('()') ? 1 : 0);
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value="" onValueChange={(key) => insert(`{${key}}`)} disabled={disabled}>
          <SelectTrigger size="sm" aria-label="Insert field">
            <SelectValue placeholder="Insert field…" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>This record</SelectLabel>
              {fields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                  <code className="font-mono text-muted-foreground text-xs">{`{${f.key}}`}</code>
                </SelectItem>
              ))}
            </SelectGroup>
            {refGroups.map(([group, refs]) => (
              <SelectGroup key={group}>
                <SelectLabel>Related · {group}</SelectLabel>
                {refs.map((r) => (
                  <SelectItem key={r.path} value={r.path}>
                    {r.label}
                    <code className="font-mono text-muted-foreground text-xs">{`{${r.path}}`}</code>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        {showReturnType && (
          <Select
            value={returnType ?? ''}
            onValueChange={(v) => onReturnTypeChange?.(v as FieldType)}
            disabled={disabled}
          >
            <SelectTrigger size="sm" className="ml-auto" aria-label="Return type">
              <SelectValue placeholder="Return type…" />
            </SelectTrigger>
            <SelectContent>
              {RETURN_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Textarea
        ref={textareaRef}
        value={formula}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="{amount} * ({probability} / 100)"
        spellCheck={false}
        className="min-h-24 font-mono text-xs leading-relaxed"
        aria-label="Formula"
      />

      <div className="flex flex-wrap gap-1.5">
        {functionChips.map((name) => (
          <Chip
            key={name}
            type="button"
            disabled={disabled}
            className="px-2 py-0.5 font-mono"
            onClick={() => insert(`${name}()`)}
          >
            {name}
          </Chip>
        ))}
      </div>

      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === 'idle') {
    return (
      <p className="text-muted-foreground text-xs">
        Reference fields as <code className="font-mono">{'{key}'}</code>; related records one hop
        away as <code className="font-mono">{'{ref.key}'}</code>.
      </p>
    );
  }
  if (status.kind === 'valid') {
    return (
      <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--success)' }}>
        <CheckCircle2 className="size-3.5" />
        Valid formula
      </p>
    );
  }
  if (status.kind === 'warning') {
    return (
      <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--warning)' }}>
        <AlertTriangle className="size-3.5" />
        {status.message}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-destructive text-xs">
      <AlertCircle className="size-3.5" />
      {status.message}
    </p>
  );
}
