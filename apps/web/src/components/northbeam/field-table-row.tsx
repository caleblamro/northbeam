'use client';

import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FieldConfig } from '@northbeam/db/field-types';
import { Check, Info, Minus, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

// Field-type → tone mapping. The tones share a neutral background and only
// differ in a small color-dot prefix, so the field list reads as a label,
// not a colored block. Defined in components/ui/badge.tsx.
type TypeTone = Extract<BadgeTone, 'text' | 'number' | 'date' | 'choice' | 'relation' | 'computed'>;

/** The subset of a field def this row renders. Wider than FieldDefLite —
 *  the metadata table needs id/isSystem/indexed too. */
type FieldRow = {
  id: string;
  key: string;
  label: string;
  type: string;
  config?: FieldConfig | null;
  isSystem?: boolean;
  required?: boolean;
  indexed?: boolean;
};

export function FieldTableRow({
  field,
  toneMap,
  onEdit,
}: {
  field: FieldRow;
  toneMap: Record<string, TypeTone>;
  /** Opens the field editor. System fields open too — config-only edit. */
  onEdit?: () => void;
}) {
  const cfg = field.config ?? {};
  const tone = toneMap[field.type] ?? 'text';
  const meta = fieldMeta(field.type, cfg);

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-foreground">{field.label}</span>
          {field.isSystem && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-muted-foreground" aria-label="System field">
                  <Info className="size-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                System field — managed by Northbeam. Label and options can be edited; it can't be
                deleted or made optional.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {(cfg.description || cfg.helpText) && (
          <div className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
            {cfg.description ?? cfg.helpText}
          </div>
        )}
      </TableCell>
      <TableCell>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{field.key}</code>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Badge tone={tone} size="sm" className="uppercase tracking-wider">
            {field.type}
          </Badge>
          {meta && <span className="max-w-48 truncate text-muted-foreground text-xs">{meta}</span>}
        </div>
      </TableCell>
      <TableCell className="text-center">
        <BoolDot value={!!field.required} />
      </TableCell>
      <TableCell className="text-center">
        <BoolDot value={!!field.indexed} />
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${field.label}`}
          disabled={!onEdit}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function BoolDot({ value }: { value: boolean }): ReactNode {
  return value ? (
    <Check className="mx-auto size-4 text-emerald-600 dark:text-emerald-400" />
  ) : (
    <Minus className="mx-auto size-3.5 text-muted-foreground/40" />
  );
}

/** Short inline metadata to render next to the type pill (e.g., "→ account"
 *  for a reference, "USD" for a currency, "12 options" for a picklist,
 *  "SUM · deal.amount" for a rollup). */
function fieldMeta(type: string, cfg: FieldConfig): string | null {
  if (type === 'reference' && cfg.targetObject) return `→ ${cfg.targetObject}`;
  if (type === 'currency' && cfg.currencyCode) return cfg.currencyCode;
  if ((type === 'picklist' || type === 'multipicklist') && cfg.options?.length) {
    return `${cfg.options.length} options`;
  }
  if (type === 'formula' && cfg.formula) return `= ${cfg.formula}`;
  if (type === 'rollup' && cfg.rollup) {
    const r = cfg.rollup;
    return `${r.fn.toUpperCase()} · ${r.childObject}${r.childField ? `.${r.childField}` : ''}`;
  }
  return null;
}
