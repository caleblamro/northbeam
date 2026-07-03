'use client';

// Pipeline stage path — chevron segments over a record's stage/status
// picklist (Salesforce "Path" pattern). Completed stages fill with the accent
// soft tone, the current stage with the brand fill, future stages stay
// sunken. Clicking a segment moves the record there with an optimistic
// record.get patch.

import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Check } from 'lucide-react';
import type { FieldDefLite } from './field-render';

/** The record's pipeline field, if it has one: a picklist keyed `stage`
 *  (preferred) or `status` with at least 2 options. */
export function findStageField(fields: FieldDefLite[]): FieldDefLite | null {
  for (const key of ['stage', 'status']) {
    const f = fields.find((x) => x.key === key && x.type === 'picklist');
    if (f && (f.config?.options?.length ?? 0) >= 2) return f;
  }
  return null;
}

export function StagePath({
  objectKey,
  recordId,
  field,
  value,
}: {
  objectKey: string;
  recordId: string;
  field: FieldDefLite;
  value: unknown;
}) {
  const utils = trpc.useUtils();
  const options = field.config?.options ?? [];
  const currentIdx = options.findIndex((o) => o.value === value);

  const update = trpc.record.update.useMutation({
    meta: { context: `Couldn't update ${field.label.toLowerCase()}` },
    onMutate: async ({ data }) => {
      const input = { objectKey, id: recordId };
      await utils.record.get.cancel(input);
      const prev = utils.record.get.getData(input);
      utils.record.get.setData(input, (old) =>
        old ? { ...old, row: { ...old.row, data: { ...old.row.data, ...data } } } : old,
      );
      return { prev, input };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) utils.record.get.setData(ctx.input, ctx.prev);
    },
    onSettled: () => {
      utils.record.get.invalidate({ objectKey, id: recordId });
      utils.record.list.invalidate();
    },
  });

  const last = options.length - 1;
  return (
    <nav aria-label={field.label} className="flex gap-[3px]">
      {options.map((o, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'future';
        // Chevron geometry: arrow tail cut into the left edge (except the
        // first segment), arrow head on the right (except the last).
        const clip =
          i === 0
            ? 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)'
            : i === last
              ? 'polygon(0 0, 100% 0, 100% 100%, 0 100%, 9px 50%)'
              : 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)';
        return (
          <button
            key={o.value}
            type="button"
            aria-current={state === 'current' ? 'step' : undefined}
            disabled={update.isPending || state === 'current'}
            onClick={() =>
              update.mutate({ objectKey, id: recordId, data: { [field.key]: o.value } })
            }
            style={{
              clipPath: clip,
              borderRadius: i === 0 ? '4px 0 0 4px' : i === last ? '0 4px 4px 0' : undefined,
            }}
            className={cn(
              'relative flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 px-3.5 font-medium text-xs transition-colors focus-visible:z-10 focus-visible:outline-none',
              state === 'done' &&
                'bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-ring)]',
              state === 'current' && 'bg-primary text-primary-foreground',
              state === 'future' &&
                'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            )}
          >
            {state === 'done' ? (
              <Check className="size-3.5 shrink-0" />
            ) : (
              o.color &&
              state !== 'current' && (
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: o.color }} />
              )
            )}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
