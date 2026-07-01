'use client';

import { SectionCard } from '@/components/northbeam/section-card';
import { Callout } from '@/components/ui/callout';
import { CreditCard } from 'lucide-react';

export default function BillingSetupPage() {
  return (
    <SectionCard title="Billing & plan">
      <Callout variant="info" icon={CreditCard} title="Coming soon">
        Plans, payment methods, and invoices will live here once Stripe is connected.
      </Callout>
    </SectionCard>
  );
}
