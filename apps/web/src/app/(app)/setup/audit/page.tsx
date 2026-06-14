'use client';

import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { FileClock } from 'lucide-react';

export default function AuditSetupPage() {
  return (
    <SectionCard title="Audit log">
      <EmptyState
        icon={FileClock}
        title="Audit log isn't built yet"
        body="Every create, update, delete, role change, and login will land here so admins can answer 'who did that, and when?' without leaving the app."
        size="sm"
      />
    </SectionCard>
  );
}
