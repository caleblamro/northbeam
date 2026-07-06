import { redirect } from 'next/navigation';

// There are no separate "dashboards" — they're saved views. The library at
// /views is the one home for all of them; individual workspace dashboards
// still render at /dashboards/[id].
export default function DashboardsPage() {
  redirect('/views');
}
