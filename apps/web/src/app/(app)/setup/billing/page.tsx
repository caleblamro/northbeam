'use client';

import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { CreditCard } from 'lucide-react';

export default function BillingSetupPage() {
  return (
    <SectionCard title="Billing & plan">
      <EmptyState
        icon={CreditCard}
        title="Billing isn't wired up yet"
        body="Plans, payment methods, and invoices will live here once Stripe is connected."
        size="sm"
      />
    </SectionCard>
  );
}
