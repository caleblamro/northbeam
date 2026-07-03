'use client';

// Setup → Roles & permissions. Directus-style two-pane editor: role rail +
// per-object CRUD grid. The whole surface is gated on 'org.roles.manage' (the
// nav hides it otherwise; the API enforces it regardless).

import { EmptyState } from '@/components/northbeam/empty-state';
import { RolesManager } from '@/components/northbeam/roles-manager';
import { useCan } from '@/lib/can';
import { ShieldHalf } from 'lucide-react';

export default function RolesSetupPage() {
  const canManage = useCan('org.roles.manage');
  if (!canManage) {
    return (
      <EmptyState
        icon={ShieldHalf}
        title="Not available"
        body="You need permission to manage roles for this workspace."
      />
    );
  }
  return <RolesManager />;
}
