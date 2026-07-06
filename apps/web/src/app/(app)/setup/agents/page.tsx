'use client';

// Setup → AI agents. Presets that ai.chat threads run as: system prompt,
// allowed models, tool allowlist, and role visibility. Gated on
// 'ai.agents.manage' (nav hides the entry; the API enforces regardless).

import { AgentsManager } from '@/components/northbeam/agents-manager';
import { EmptyState } from '@/components/northbeam/empty-state';
import { useCan } from '@/lib/can';
import { Bot } from 'lucide-react';

export default function AgentsSetupPage() {
  const canManage = useCan('ai.agents.manage');
  if (!canManage) {
    return (
      <EmptyState
        icon={Bot}
        title="Not available"
        body="You need permission to manage AI agents for this workspace."
      />
    );
  }
  return <AgentsManager />;
}
