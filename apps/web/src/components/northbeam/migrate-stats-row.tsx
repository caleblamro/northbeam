// Big-number summary row for a migration run (objects / fields / records / …).
// Used while importing and on the completion summary.

import type { CSSProperties } from 'react';
import { EyebrowLabel } from './eyebrow-label';

export function StatsRow({ stats }: { stats: Record<string, unknown> }) {
  const items: Array<[string, unknown]> = [
    ['Objects', stats.objects],
    ['Fields', stats.fields],
    ['Records read', stats.records],
    ['Imported', stats.imported],
    ['References linked', stats.refsResolved],
  ];
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4">
      {items.map(([label, v], i) => (
        <div
          key={label}
          className="reveal"
          style={{ '--reveal-delay': `${i * 40}ms` } as CSSProperties}
        >
          <EyebrowLabel className="block">{label}</EyebrowLabel>
          <div className="mt-1.5 font-normal text-foreground text-xl tabular-nums tracking-[-0.025em]">
            {typeof v === 'number' ? v.toLocaleString() : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}
