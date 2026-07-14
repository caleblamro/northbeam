'use client';

// Headless visit tracker mounted once in the shell: any /{objectKey}/{id}
// page registers in the recents list (idempotent on refresh/deep-link — the
// record.get query is cache-shared with RecordView, so this adds no fetch).

import { trpc } from '@/lib/api';
import { touchRecent } from '@/lib/recent-records';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const RECORD_PATH = /^\/([a-z][a-z0-9_]*)\/([0-9a-f-]{36})$/;

export function useRecordVisitTracker(): void {
  const pathname = usePathname();
  const m = pathname.match(RECORD_PATH);
  const objectKey = m?.[1] ?? null;
  const id = m?.[2] ?? null;

  const rec = trpc.record.get.useQuery(
    { objectKey: objectKey ?? '', id: id ?? '' },
    { enabled: Boolean(objectKey && id), retry: false, meta: { silent: true } },
  );

  useEffect(() => {
    if (!objectKey || !id || !rec.data) return;
    touchRecent({
      objectKey,
      id,
      name: rec.data.row.name,
      objectLabel: rec.data.object.label,
      color: rec.data.object.color,
    });
  }, [objectKey, id, rec.data]);
}
