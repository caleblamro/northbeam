// The built-in Home layout ("focus queue"): greeting → live KPI strip →
// needs-attention queue → pipeline chart beside recent activity → deals
// closing soon. Expressed as an artifact tree so home renders through the
// same walker as AI dashboards — the moment a user asks the composer to
// change it, this is the seed being refined, and the result persists as
// their workspace-scoped `home` view.
//
// Live nodes reference the standard seeded objects (deal/account/contact/
// activity). Orgs that renamed or dropped them degrade per-node (the walker's
// soft "unsupported" placeholder), never a crash.

import type { ArtifactLike } from '@northbeam/core/artifact';

const OPEN_DEAL_FILTERS = [
  { fieldKey: 'stage', op: 'neq', value: 'closed_won' },
  { fieldKey: 'stage', op: 'neq', value: 'closed_lost' },
];

export const DEFAULT_HOME_ARTIFACT: ArtifactLike = {
  version: '1',
  components: [
    { component: 'Greeting', props: { span: 12 } },

    // Slim inline stat band (the H3 hero strip) — all live aggregates.
    {
      component: 'StatBand',
      props: {
        span: 12,
        link: { label: 'View pipeline', href: '/pipeline' },
        items: [
          {
            label: 'open pipeline',
            objectKey: 'deal',
            fn: 'sum',
            fieldKey: 'amount',
            filters: OPEN_DEAL_FILTERS,
          },
          { label: 'open deals', objectKey: 'deal', fn: 'count', filters: OPEN_DEAL_FILTERS },
          { label: 'accounts', objectKey: 'account', fn: 'count' },
          { label: 'contacts', objectKey: 'contact', fn: 'count' },
        ],
      },
    },

    // The actionable queue — the top overdue/due-soon items, "+N more" folds
    // the rest behind a view-all link.
    { component: 'AttentionQueue', props: { span: 12, limit: 5 } },

    // Evidence row: pipeline shape beside the latest touches.
    {
      component: 'Chart',
      props: {
        span: 7,
        title: 'Pipeline by stage',
        objectKey: 'deal',
        groupBy: 'stage',
        fn: 'sum',
        measure: 'amount',
        chartType: 'bar',
        filters: OPEN_DEAL_FILTERS,
      },
    },
    {
      component: 'SectionCard',
      props: { title: 'Recent activity', span: 5 },
      children: [
        {
          component: 'RecordList',
          props: { objectKey: 'activity', secondaryField: 'type', limit: 7 },
        },
      ],
    },

    // Records are the destination — the open deals nearest their close date.
    { component: 'Heading', props: { span: 12, text: 'Closing soon' } },
    {
      component: 'RecordTable',
      props: {
        span: 12,
        objectKey: 'deal',
        filters: [...OPEN_DEAL_FILTERS, { fieldKey: 'close_date', op: 'isSet' }],
        sort: [{ fieldKey: 'close_date', direction: 'asc' }],
        columns: ['stage', 'amount', 'close_date'],
        limit: 5,
      },
    },
  ],
};
