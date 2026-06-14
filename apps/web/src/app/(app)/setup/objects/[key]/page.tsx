'use client';

// Object detail — properties + field list for a single object def. Read-only
// scaffold; the field editor + layout customizer (#17 / #18) will hang off
// this page. We deliberately render through trpc.object.get rather than
// re-querying the index so this page works as a direct deep link.

import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import { type VariantProps, cva } from 'class-variance-authority';
import {
  ArrowLeft,
  Check,
  Database,
  Info,
  Loader2,
  Minus,
  Pencil,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';

// Color-coded type groups so the field list reads at a glance. Computed types
// keep their warning tint until the engine ships (issue #17 backlog).
const typePillVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wider',
  {
    variants: {
      tone: {
        text: 'bg-muted text-muted-foreground',
        number: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
        date: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
        choice: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        relation: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        computed: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
      },
    },
    defaultVariants: { tone: 'text' },
  },
);

type TypeTone = NonNullable<VariantProps<typeof typePillVariants>['tone']>;

const TYPE_TONE: Record<string, TypeTone> = {
  text: 'text',
  textarea: 'text',
  email: 'text',
  phone: 'text',
  url: 'text',
  number: 'number',
  currency: 'number',
  percent: 'number',
  autonumber: 'computed',
  date: 'date',
  datetime: 'date',
  checkbox: 'choice',
  picklist: 'choice',
  multipicklist: 'choice',
  reference: 'relation',
  formula: 'computed',
  rollup: 'computed',
  ai: 'computed',
};

export default function ObjectDetailPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const q = trpc.object.get.useQuery({ key });

  if (q.isLoading) {
    return (
      <SectionCard icon={Database} title="Loading…">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </SectionCard>
    );
  }

  if (!q.data) {
    return (
      <SectionCard icon={Database} title="Not found">
        <EmptyState
          icon={Database}
          title="Object not found"
          body={`Couldn't find an object with key "${key}" in this workspace.`}
          size="sm"
        />
      </SectionCard>
    );
  }

  const { object, fields } = q.data;

  return (
    <>
      <Breadcrumb objectLabel={object.label} />

      <SectionCard
        icon={Database}
        title="Properties"
        action={
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
            {object.isSystem ? 'Standard' : 'Custom'}
          </span>
        }
      >
        <DescriptionList
          labelWidth="md"
          items={[
            { label: 'Label', value: object.label },
            {
              label: 'API name',
              value: <code className="text-xs">{object.key}</code>,
              valueClassName: 'font-mono',
            },
            {
              label: 'Table name',
              value: <code className="text-xs">{object.tableName}</code>,
              valueClassName: 'font-mono',
            },
            {
              label: 'Source',
              value: (
                <span className="capitalize">{object.source ?? 'native'}</span>
              ),
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        icon={Database}
        title={`Fields (${fields.length})`}
        action={
          <Button variant="outline" disabled>
            <Pencil />
            New field
          </Button>
        }
        padding="none"
      >
        {fields.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No fields"
            body="This object has no field definitions yet."
            size="sm"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>API name</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-20 text-center">Required</TableHead>
                <TableHead className="w-20 text-center">Indexed</TableHead>
                <TableHead className="w-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f) => {
                const cfg = (f.config ?? {}) as {
                  description?: string;
                  helpText?: string;
                  targetObject?: string;
                  currencyCode?: string;
                  options?: { value: string; label: string }[];
                };
                const tone = TYPE_TONE[f.type] ?? 'text';
                const meta = fieldMeta(f.type, cfg);
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">{f.label}</span>
                        {f.isSystem && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground" aria-label="System field">
                                <Info className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              System field — managed by Northbeam, can't be edited.
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
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {f.key}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn(typePillVariants({ tone }))}>{f.type}</span>
                        {meta && (
                          <span className="text-muted-foreground text-xs">{meta}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <BoolDot value={f.required} />
                    </TableCell>
                    <TableCell className="text-center">
                      <BoolDot value={f.indexed} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit field"
                        disabled
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}

function Breadcrumb({ objectLabel }: { objectLabel: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button asChild variant="ghost" size="sm" className="h-7 px-2">
        <Link href="/setup/objects">
          <ArrowLeft className="size-3.5" />
          Object manager
        </Link>
      </Button>
      <span className="text-muted-foreground">/</span>
      <span className="font-semibold text-foreground">{objectLabel}</span>
    </div>
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
 *  for a reference, "USD" for a currency, "12 options" for a picklist). */
function fieldMeta(
  type: string,
  cfg: {
    targetObject?: string;
    currencyCode?: string;
    options?: { value: string; label: string }[];
  },
): string | null {
  if (type === 'reference' && cfg.targetObject) return `→ ${cfg.targetObject}`;
  if (type === 'currency' && cfg.currencyCode) return cfg.currencyCode;
  if ((type === 'picklist' || type === 'multipicklist') && cfg.options?.length) {
    return `${cfg.options.length} options`;
  }
  return null;
}
