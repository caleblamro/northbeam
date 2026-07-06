'use client';

// /ai — the AI hub: start a chat with an agent, resume recent/shared threads,
// and browse (or save) previously composed dashboards.

import { AiHub } from '@/components/northbeam/ai-hub';
import { PageActions } from '@/components/northbeam/app-shell';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default function AiHubPage() {
  return (
    <>
      <PageActions>
        <Button asChild>
          <Link href="/ai/chat/new">
            <Plus />
            New chat
          </Link>
        </Button>
      </PageActions>
      <AiHub />
    </>
  );
}
