'use client';

// /views — the library of every saved view (dashboards, reports, lists,
// record layouts) the caller can see, organized by object (V2 "explorer"),
// with sharing managed in place. Creation fans out from one menu: compose a
// dashboard with AI, build a report, or save a list from any object page.

import { useAiComposer } from '@/components/northbeam/ai-composer';
import { PageActions } from '@/components/northbeam/app-shell';
import { ViewsLibrary } from '@/components/northbeam/views-library';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChartBar, List, Plus, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function ViewsPage() {
  const composer = useAiComposer();
  const router = useRouter();
  return (
    <>
      <PageActions>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <Plus />
              New view
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Create</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => composer.open()}>
              <Sparkles className="size-3.5 text-link" />
              Compose with AI
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/reports/builder')}>
              <ChartBar className="size-3.5" />
              Report
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/deals')}>
              <List className="size-3.5" />
              List — save one from any object page
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageActions>
      <ViewsLibrary />
    </>
  );
}
