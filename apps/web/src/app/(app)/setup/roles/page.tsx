'use client';

// Setup → Roles & permissions — the P2×P3 surface: persona cards (members +
// capability meters + manage menu) over the access matrix (roles as columns,
// every permission — workspace, object CRUD, AI tools — as rows, instant
// saves). Gated on 'org.roles.manage' (the nav hides it otherwise; the API
// enforces it regardless).

import { EmptyState } from '@/components/northbeam/empty-state';
import { RolesAccess } from '@/components/northbeam/roles-access';
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
  return <RolesAccess />;
}
