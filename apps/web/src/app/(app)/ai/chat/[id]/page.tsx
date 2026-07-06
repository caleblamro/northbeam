'use client';

// /ai/chat/<id> — resume (or read, when shared) one stored AI chat thread.
// The surface hydrates from ai.sessionGet: text bubbles, static tool chips,
// artifact markers, and the latest artifact on the right-hand canvas.

import { AiChatSurface } from '@/components/northbeam/ai-chat';
import { HidePageHead } from '@/components/northbeam/app-shell';
import { useParams } from 'next/navigation';

export default function AiChatPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <HidePageHead />
      <AiChatSurface key={params.id} sessionId={params.id} />
    </>
  );
}
