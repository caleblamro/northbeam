'use client';

// /ai/chat/new — a fresh full-page chat. `?agent=<id>` preselects an agent
// (the hub's agent cards link here); the first completed turn persists the
// thread server-side and the surface rewrites the URL to /ai/chat/<id>.

import { AiChatSurface } from '@/components/northbeam/ai-chat';
import { HidePageHead } from '@/components/northbeam/app-shell';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function NewChat() {
  const params = useSearchParams();
  return <AiChatSurface initialAgentId={params.get('agent') ?? undefined} />;
}

export default function NewAiChatPage() {
  return (
    <>
      <HidePageHead />
      <Suspense>
        <NewChat />
      </Suspense>
    </>
  );
}
