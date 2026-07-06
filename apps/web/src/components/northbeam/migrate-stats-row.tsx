// Big-number summary row for a migration run (objects / fields / records / …).
// Used while importing and on the completion summary.

import type { CSSProperties } from 'react';
import { EyebrowLabel } from './eyebrow-label';

export function StatsRow({ stats }: { stats: Record<string, unknown> }) {
  // Translated flows + workflow rules + "rebuild manually" references — the
  // total automation rows the import created (— until the phase reports).
  const automationParts = [
    stats.flowsTranslated,
    stats.workflowRulesTranslated,
    stats.flowsReferenced,
  ].filter((n): n is number => typeof n === 'number');
  const items: Array<[string, unknown]> = [
    ['Objects', stats.objects],
    ['Fields', stats.fields],
    ['Records read', stats.records],
    ['Imported', stats.imported],
    ['References linked', stats.refsResolved],
    ['Reports', stats.reportsImported],
    ['Dashboards', stats.dashboardsImported],
    ['Flows', stats.flowsTranslated],
    [
      'Automations',
      automationParts.length ? automationParts.reduce((a, b) => a + b, 0) : undefined,
    ],
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
