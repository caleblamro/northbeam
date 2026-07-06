'use client';

// Audit log — every mutating action across the workspace, newest first.
// Writes are wired inline from the corresponding mutations (view.*,
// ai.generate, object.updateLayout, etc.); read access is gated to admin+
// by the API. Empty state when nothing has been recorded yet.

import { AuditTable } from '@/components/northbeam/audit-table';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { FileClock } from 'lucide-react';
import { useState } from 'react';

const PAGE_SIZE = 50;

export default function AuditSetupPage() {
  const [page, setPage] = useState(0);
  const events = trpc.audit.list.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const rows = events.data ?? [];
  const hasNext = rows.length === PAGE_SIZE;

  return (
    <SectionCard
      icon={FileClock}
      title="Audit log"
      action={
        <span className="text-muted-foreground text-xs">
          Every create / update / delete across the workspace
        </span>
      }
      padding="none"
    >
      {events.isLoading ? (
        <LoadingScreen size="md" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="Nothing recorded yet"
          body="Audit events show up here the moment someone changes a record, edits a view, or composes with Build."
          size="sm"
        />
      ) : (
        <AuditTable
          rows={rows}
          page={page}
          hasNext={hasNext}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      )}
    </SectionCard>
  );
}
