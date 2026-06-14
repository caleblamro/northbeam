'use client';

// Pipeline is a list view of `deal`. The kanban presentation comes back as a
// view mode (#26) — until then this is the same RecordListView every other
// object uses. No special UI per the audit; the AI artifact renderer can
// layer a stage-grouped board on top later.

import { RecordListView } from '@/components/northbeam/record-list-view';

export default function PipelinePage() {
  return <RecordListView objectKey="deal" newLabel="New deal" />;
}
