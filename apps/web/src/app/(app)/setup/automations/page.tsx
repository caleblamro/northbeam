'use client';

// Setup → Automation → Flows. The SetupShell layout provides the left nav;
// this page is just the shared AutomationList (also reused, pre-filtered, by
// the object manager's Automations tab).

import { AutomationList } from '@/components/northbeam/automation/automation-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { ShieldHalf } from 'lucide-react';

export default function AutomationsSetupPage() {
  const boot = trpc.me.bootstrap.useQuery();
  const canManage = useCan('automation.manage');

  if (boot.isLoading) return <LoadingScreen size="md" />;

  if (!canManage) {
    return (
      <SectionCard title="Automations">
        <EmptyState
          icon={ShieldHalf}
          title="No automation access"
          body="Managing flows needs the 'automation.manage' permission — ask a workspace admin."
          size="sm"
        />
      </SectionCard>
    );
  }

  return <AutomationList />;
}
