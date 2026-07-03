'use client';

// MatrixTable — the two-dimension pivot render for `matrix` reports:
// primary groups as rows, secondary groups as columns (top 12 + "Other"),
// aggregate values in the cells. Totals column/row only where they're
// additive (count/sum) — a "total" of averages or extremes would lie.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import {
  type AggBucket,
  type AggregateFn,
  fmtAggregate,
  pivotBuckets,
  totalOf,
} from '@/components/northbeam/views/aggregate-data';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const MATRIX_SERIES_CAP = 12;

export function MatrixTable({
  buckets,
  agg,
  labelOf,
  label2Of,
  groupLabel,
  measureField,
}: {
  buckets: AggBucket[];
  agg: AggregateFn;
  labelOf: (g: AggBucket['group']) => string;
  label2Of: (g: AggBucket['group']) => string;
  /** Header for the row-label column (the primary group field's label). */
  groupLabel: string;
  measureField?: FieldDefLite;
}) {
  const { rows, series } = pivotBuckets({
    buckets,
    agg,
    labelOf,
    label2Of,
    seriesCap: MATRIX_SERIES_CAP,
  });
  const additive = agg === 'count' || agg === 'sum';
  const fmt = (n: number) => fmtAggregate(n, measureField);

  const rowTotal = (cells: (typeof rows)[number]['cells']): number =>
    Object.values(cells).reduce((acc, c) => acc + c.value, 0);
  const columnTotal = (key: string): number =>
    rows.reduce((acc, r) => acc + (r.cells[key]?.value ?? 0), 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{groupLabel}</TableHead>
          {series.map((s) => (
            <TableHead key={s.key} className="text-right">
              {s.label}
            </TableHead>
          ))}
          {additive && <TableHead className="text-right">Total</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label}>
            <TableCell>{r.label}</TableCell>
            {series.map((s) => {
              const cell = r.cells[s.key];
              return (
                <TableCell key={s.key} className="text-right tabular-nums">
                  {cell ? fmt(cell.value) : <span className="text-muted-foreground">—</span>}
                </TableCell>
              );
            })}
            {additive && (
              <TableCell className="text-right font-medium tabular-nums">
                {fmt(rowTotal(r.cells))}
              </TableCell>
            )}
          </TableRow>
        ))}
        {additive && rows.length > 1 && (
          <TableRow>
            <TableCell className="font-medium">Total</TableCell>
            {series.map((s) => (
              <TableCell key={s.key} className="text-right font-medium tabular-nums">
                {fmt(columnTotal(s.key))}
              </TableCell>
            ))}
            <TableCell className="text-right font-medium tabular-nums">
              {fmt(totalOf(buckets, agg))}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
