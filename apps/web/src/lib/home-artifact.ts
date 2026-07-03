// The built-in Home layout ("focus queue"): greeting → workspace KPI strip →
// needs-attention queue → recent activity. Expressed as an artifact tree so
// home renders through the same walker as AI dashboards — the moment a user
// asks the composer to change it, this is the seed being refined, and the
// result persists as their workspace-scoped `home` view.
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
    {
      component: 'Metric',
      props: {
        span: 3,
        label: 'Open pipeline',
        objectKey: 'deal',
        fn: 'sum',
        fieldKey: 'amount',
        filters: OPEN_DEAL_FILTERS,
      },
    },
    {
      component: 'Metric',
      props: {
        span: 3,
        label: 'Open deals',
        objectKey: 'deal',
        fn: 'count',
        filters: OPEN_DEAL_FILTERS,
      },
    },
    {
      component: 'Metric',
      props: { span: 3, label: 'Accounts', objectKey: 'account', fn: 'count' },
    },
    {
      component: 'Metric',
      props: { span: 3, label: 'Contacts', objectKey: 'contact', fn: 'count' },
    },
    { component: 'AttentionQueue', props: { span: 12 } },
    {
      component: 'SectionCard',
      props: { title: 'Recent activity', span: 12 },
      children: [
        {
          component: 'RecordList',
          props: { objectKey: 'activity', secondaryField: 'type', limit: 8 },
        },
      ],
    },
  ],
};
