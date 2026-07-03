'use client';

// /views — the library of every saved view (dashboards, reports, lists,
// record layouts) the caller can see, with sharing managed in place.

import { useAiComposer } from '@/components/northbeam/ai-composer';
import { PageActions } from '@/components/northbeam/app-shell';
import { ViewsLibrary } from '@/components/northbeam/views-library';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export default function ViewsPage() {
  const composer = useAiComposer();
  return (
    <>
      <PageActions>
        <Button onClick={() => composer.open()}>
          <Plus />
          New view
        </Button>
      </PageActions>
      <ViewsLibrary />
    </>
  );
}
