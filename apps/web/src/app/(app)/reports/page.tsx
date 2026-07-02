'use client';

// Reports index — ask bar, insight strip, forecast + saved reports. The
// layout owns the page header (PAGE_META['/reports']); this page registers
// the "New report" action and stacks its sections on the mb-7 rhythm with
// the shared reveal stagger.

import { PageActions } from '@/components/northbeam/app-shell';
import {
  ReportsAskBar,
  ReportsInsights,
  RevenueForecastCard,
  WeeklyChangeCard,
} from '@/components/northbeam/reports-overview';
import { SavedReports } from '@/components/northbeam/saved-reports';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default function ReportsPage() {
  return (
    <>
      <PageActions>
        <Button variant="outline" asChild>
          <Link href="/reports/builder">
            <Plus />
            New report
          </Link>
        </Button>
      </PageActions>

      <div className="mb-7">
        <ReportsAskBar />
      </div>

      <div className="mb-7">
        <ReportsInsights />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="reveal" style={{ '--reveal-delay': '320ms' } as React.CSSProperties}>
          <RevenueForecastCard />
        </div>
        <div className="flex flex-col gap-4">
          <div className="reveal" style={{ '--reveal-delay': '380ms' } as React.CSSProperties}>
            <WeeklyChangeCard />
          </div>
          <div className="reveal" style={{ '--reveal-delay': '440ms' } as React.CSSProperties}>
            <SectionCard title="Saved reports">
              <SavedReports />
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
}
