'use client';

// Row-level (criteria) scope editor for one object in the roles grid. Sets the
// `object_permission.filter` — a flat AND of conditions that limits which
// records of the object the role can see/act on. Reuses FilterRow (the same
// field/op/value control the list + report builders use), and lazily loads the
// object's fields only when opened. Server auto-indexes referenced fields.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FilterRow } from '@/components/northbeam/filter-bar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Filter } from '@northbeam/db/views';
import { Loader2, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

export function RoleObjectCriteria({
  objectKey,
  objectLabel,
  value,
  onChange,
  disabled,
}: {
  objectKey: string;
  objectLabel: string;
  value: Filter[];
  onChange: (next: Filter[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filter[]>(value);
  const utils = trpc.useUtils();
  const metaQ = trpc.object.get.useQuery({ key: objectKey }, { enabled: open, staleTime: 60_000 });
  const fields = (metaQ.data?.fields ?? []) as FieldDefLite[];
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const count = value.length;

  const openDialog = () => {
    setDraft(value);
    setOpen(true);
  };
  const addBlank = () => {
    const f = fields[0];
    if (!f) return;
    setDraft((d) => [...d, { fieldKey: f.key, op: 'eq', value: null }]);
  };
  const apply = () => {
    onChange(draft.filter((f) => f.fieldKey));
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={openDialog}
        title={
          count > 0 ? `${count} condition${count === 1 ? '' : 's'}` : 'Limit to matching records'
        }
        className={cn(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors disabled:opacity-40',
          count > 0
            ? 'font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="size-3.5" />
        {count > 0 ? count : null}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record conditions — {objectLabel}</DialogTitle>
            <DialogDescription>
              This role can only see and act on {objectLabel.toLowerCase()} records matching{' '}
              <span className="font-medium">all</span> of these conditions. Leave empty for all
              records.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 py-1">
            {metaQ.isLoading ? (
              <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading fields…
              </div>
            ) : (
              <>
                {draft.map((row, i) => (
                  <FilterRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                    key={i}
                    index={i}
                    row={row}
                    fields={fields}
                    byKey={byKey}
                    loadReferenceOptions={(targetObject, query) =>
                      utils.record.searchRefs.fetch({ objectKey: targetObject, q: query })
                    }
                    onChange={(patch) =>
                      setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)))
                    }
                    onRemove={() => setDraft((d) => d.filter((_, j) => j !== i))}
                  />
                ))}
                <Button variant="outline" size="sm" className="self-start" onClick={addBlank}>
                  <Plus />
                  Add condition
                </Button>
              </>
            )}
          </div>

          <DialogFooter>
            {count > 0 && (
              <Button
                variant="ghost"
                className="mr-auto text-muted-foreground"
                onClick={() => {
                  onChange([]);
                  setOpen(false);
                }}
              >
                Clear all
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={apply}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
