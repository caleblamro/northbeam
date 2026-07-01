'use client';

// Landing page after the magic-link callback. Better Auth has already set the
// session cookie on the API origin and redirected here; we bootstrap to learn
// whether the user has an org, then route them on.

import { Spinner } from '@/components/northbeam/primitives';
import { trpc } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function VerifyPage() {
  const router = useRouter();
  const boot = trpc.me.bootstrap.useQuery();

  useEffect(() => {
    if (!boot.data) return;
    if (!boot.data.session) {
      router.replace('/sign-in');
    } else if (!boot.data.activeOrg) {
      router.replace('/create-org');
    } else {
      router.replace('/');
    }
  }, [boot.data, router]);

  return (
    <div className="reveal flex items-center gap-3 text-muted-foreground text-sm">
      <Spinner style={{ color: 'var(--ink-muted)' }} />
      Signing you in…
    </div>
  );
}
