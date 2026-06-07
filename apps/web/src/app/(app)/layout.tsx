import { AppShell } from '@/components/northbeam/app-shell';

// Auth-gated + reads live data, so static prerender would have to wrap the
// client bootstrap per page. Flip the whole group to dynamic.
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
