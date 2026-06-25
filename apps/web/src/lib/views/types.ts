// View renderer contract. Every view type — list, kanban, calendar, ai —
// implements ViewRenderer and registers in registry.ts. RecordListView
// dispatches by view.type and never knows the specifics of any renderer.
//
// Storage types (ViewType, ShareTarget, etc.) live in @northbeam/db/views so
// the schema and the registry share one source of truth.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import type { RouterOutputs } from '@/lib/api';
import type { ViewSort, ViewType } from '@northbeam/db/views';
import type { LucideIcon } from 'lucide-react';
import type { FC } from 'react';
import type { ZodTypeAny } from 'zod';

export type { ViewType };

export type ViewRow = RouterOutputs['view']['get'];
export type RecordRow = RouterOutputs['record']['list']['rows'][number];

export type ViewRendererProps = {
  view: ViewRow;
  /** The object being viewed — drives row → detail navigation + record CRUD. */
  objectKey: string;
  objectLabel: string;
  fields: FieldDefLite[];
  rows: RecordRow[];
  refLabels: Record<string, string>;
  isLoading: boolean;
  /** Click a row → open detail. */
  onRowOpen(id: string): void;
  /** Click "Edit" in a row menu → open the form drawer. */
  onRowEdit(row: { id: string; data: Record<string, unknown> }): void;
  /** Click "Delete" in a row menu → confirm + remove. */
  onRowDelete(id: string): void;
  /** When the dispatcher is rendering a synthetic / transient overlay (e.g.
   *  `?type=ai` without a persisted view), a renderer can call this to open
   *  the save-view dialog so the user can persist their in-progress state.
   *  `overrides.config` is merged into the new view's `config` JSONB — used
   *  by the AI renderer to carry the typed prompt across the remount. */
  onSaveView?: (overrides?: { config?: unknown }) => void;
};

export type ViewRenderer<TConfig = unknown> = {
  type: ViewType;
  label: string;
  icon: LucideIcon;
  Component: FC<ViewRendererProps>;
  /** Validates the `config` JSONB on save. */
  configSchema: ZodTypeAny;
  /** What `config` to use when this renderer is first picked. */
  defaultConfig: (fields: FieldDefLite[]) => TConfig;
  /** Initial column set when the user switches TO this type (the "carry
   *  filters + sort, reset columns" rule). Falls back to the object's
   *  layout.listColumns when omitted. */
  defaultColumns?: (fields: FieldDefLite[]) => string[];
  /** When false, the type is hidden from the type-picker for this object —
   *  e.g. kanban needs at least one picklist field to group by. */
  available?: (fields: FieldDefLite[]) => boolean;
};
