'use client';

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { Badge } from '@/components/ui/badge';
import type { ObjectLayout } from '@northbeam/db/field-types';

/** Read-only summary of the persisted layout — sections + their fields,
 *  plus a count of unassigned fields. Replaced by LayoutEditor in edit mode. */
export function LayoutSummary({
  layout,
  fields,
}: {
  layout: ObjectLayout;
  fields: FieldDefLite[];
}) {
  const sections = layout.sections ?? [];
  const placed = new Set(sections.flatMap((s) => s.fields));
  const unassignedCount = fields.filter((f) => !placed.has(f.key)).length;
  const byKey = new Map(fields.map((f) => [f.key, f]));

  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No custom layout yet — every field appears in a single "More" group on the form.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => (
        <div key={s.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-medium text-foreground text-xs">
            <span>{s.label}</span>
            <Badge tone="neutral" size="sm" className="font-normal">
              {s.cols ?? 2} col
            </Badge>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{s.fields.length} fields</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.fields.map((key) => {
              const f = byKey.get(key);
              return (
                <Badge key={key} tone="neutral" size="sm" className="font-mono">
                  {f?.label ?? key}
                </Badge>
              );
            })}
          </div>
        </div>
      ))}
      {unassignedCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {unassignedCount} unassigned field{unassignedCount === 1 ? '' : 's'} — will appear in a
          generic "More" group on the form.
        </p>
      )}
    </div>
  );
}
