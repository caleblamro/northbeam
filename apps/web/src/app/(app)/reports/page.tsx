import { redirect } from 'next/navigation';

// There are no separate "reports" — they're saved views. The library at
// /views is the one home for all of them; the builder stays at
// /reports/builder as a creation flow.
export default function ReportsPage() {
  redirect('/views');
}
