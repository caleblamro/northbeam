# Table / grid layer triage

There are several overlapping table/grid abstractions in `apps/web/src`. This
documents which are actually wired into the app, which are the canonical
survivors, and which are dead. **Document-only** — no load-bearing code was
rewritten. Only zero-importer abstractions were deleted (see bottom).

## How they connect

The live rendering chain is:

```
data-grid/*  →  record-data-grid.tsx (RecordDataGrid)  →  record-table.tsx (RecordTable)
                                                              ↓
                                         list-renderer.tsx + artifact-walker.tsx
                                                              ↓
                                  lib/views/registry.ts → record-list-view.tsx → pages
record-grid.tsx  →  artifact-walker.tsx   (parallel "grid" presentation; only imports a type from record-data-grid)
```

`components/data-table/*` is a separate, self-contained TanStack-table-based
shadcn cluster that nothing outside its own directory imports.

## Findings

| Abstraction | LOC | Used by | Recommendation |
| --- | --- | --- | --- |
| `components/data-grid/*` (10 files) | ~4,008 | `record-data-grid.tsx` (`RecordDataGrid`) → `record-table.tsx` → views | **keep-canonical** — the spreadsheet/grid engine that actually backs rendered record lists |
| `components/northbeam/record-data-grid.tsx` | 180 | `record-table.tsx` (component); `record-grid.tsx` (type `RecordRow` only) | **keep-canonical** — thin adapter wrapping `DataGrid` for record rows |
| `components/northbeam/record-table.tsx` | 166 | `views/list-renderer.tsx`, `views/artifact-walker.tsx` | **keep-canonical** — composable table surface used by the view/artifact renderers |
| `components/northbeam/record-grid.tsx` | 92 | `views/artifact-walker.tsx` | **keep-canonical** — card-grid presentation for the artifact walker |
| `components/data-table/*` (9 files) | ~1,227 | **nothing** (only internal cross-imports inside the dir) | **unused-safe-to-delete** — deleted (see below) |

### Shared support files (follow-up, NOT deleted)

These exist only to serve `components/data-table/*` and become dead once it is
removed, but they live outside the table-component dirs and may be referenced by
out-of-scope (non-web) code or intended for reuse. Flagged for user sign-off
rather than deleted here:

- `lib/data-table.ts`
- `types/data-table.ts`
- `config/data-table.ts`
- `lib/parsers.ts`

### Also noted (not part of this triage)

- `components/northbeam/data-table.tsx` — a small, separate `DataTable<T>`
  component, also with zero importers. Left untouched (outside the 5 named
  abstractions); worth a separate look.

## Consolidation note

`record-table` / `record-data-grid` / `record-grid` are all thin and all live;
they are presentation variants over the same `data-grid` engine, not redundant
copies. A future pass could collapse `record-grid` into `record-table` via a
`variant` prop, but that is **consolidate-later** and needs sign-off.

## Deletions performed

`components/data-table/*` (9 files, ~1,227 LOC) — zero importers anywhere in the
repo. Deleted:

- `data-table.tsx`
- `data-table-column-header.tsx`
- `data-table-date-filter.tsx`
- `data-table-faceted-filter.tsx`
- `data-table-pagination.tsx`
- `data-table-skeleton.tsx`
- `data-table-slider-filter.tsx`
- `data-table-toolbar.tsx`
- `data-table-view-options.tsx`
