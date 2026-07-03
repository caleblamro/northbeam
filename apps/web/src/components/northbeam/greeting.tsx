'use client';

// Greeting — the Home page hero: time-of-day salutation + first name, with
// today's date and the active workspace underneath. Rendered by the artifact
// walker (`Greeting` node), so an AI-composed home keeps the same warm open.

import { trpc } from '@/lib/api';

function salutation(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Greeting({ subtitle }: { subtitle?: string }) {
  const boot = trpc.me.bootstrap.useQuery();
  const firstName = boot.data?.session?.name?.trim().split(/\s+/)[0];
  const orgName = boot.data?.activeOrg?.name;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div>
      <h1 className="font-semibold text-2xl tracking-[-0.02em]">
        {salutation()}
        {firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="mt-1 text-muted-foreground text-sm">
        {subtitle ?? [today, orgName].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}
