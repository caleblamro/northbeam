'use client';

// AiHub — the /ai landing page body. Three strata:
//   1. Agent cards — "start a chat as …" (trpc.agent.list).
//   2. Threads — the caller's recent chats + threads shared with them.
//   3. Artifact gallery — every session that produced a dashboard, as a card
//      with a size cue, an open-chat link, and Save as view.
// All data is already visibility-filtered server-side (personal sessions,
// share-resolved shared list, role-gated agents).

import { EmptyState } from '@/components/northbeam/empty-state';
import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type RouterOutputs, trpc } from '@/lib/api';
import { artifactTitle, coerceArtifact } from '@/lib/artifact-info';
import { useCan } from '@/lib/can';
import { timeAgo } from '@/lib/time';
import { useSaveArtifactAsView } from '@/lib/use-save-artifact';
import type { ArtifactLike } from '@northbeam/core/artifact';
import {
  ArrowUpRight,
  BookmarkPlus,
  Bot,
  LayoutDashboard,
  MessageSquare,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type AgentRow = RouterOutputs['agent']['list'][number];
type SessionRow = RouterOutputs['ai']['sessionList'][number];

export function AiHub() {
  const utils = trpc.useUtils();
  const agents = trpc.agent.list.useQuery();
  const sessions = trpc.ai.sessionList.useQuery();
  const shared = trpc.ai.sessionListShared.useQuery();

  const remove = trpc.ai.sessionDelete.useMutation({
    meta: { silent: true },
    onSuccess: () => utils.ai.sessionList.invalidate(),
  });

  const agentName = useMemo(() => {
    const m = new Map((agents.data ?? []).map((a) => [a.id, a.name]));
    return (id: string | null) => (id ? m.get(id) : undefined);
  }, [agents.data]);

  // Gallery: every visible session whose stored artifact still renders.
  const gallery = useMemo(() => {
    const rows = [...(sessions.data ?? []), ...(shared.data ?? [])];
    return rows.flatMap((row) => {
      const artifact = coerceArtifact(row.artifact);
      return artifact ? [{ row, artifact }] : [];
    });
  }, [sessions.data, shared.data]);

  const loading = agents.isLoading || sessions.isLoading;
  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── New chat: agent cards ── */}
      <section>
        <SectionHeading label="New chat" count={agents.data?.length ?? 0} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(agents.data ?? []).map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
          {agents.data?.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No agents available to your role — ask an admin.
            </p>
          )}
        </div>
      </section>

      {/* ── Threads: recent + shared ── */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section>
          <SectionHeading label="Recent chats" count={sessions.data?.length ?? 0} />
          <div className="mt-3">
            {(sessions.data ?? []).length === 0 ? (
              <SectionCard>
                <EmptyState
                  icon={MessageSquare}
                  title="No chats yet"
                  body="Start one with any agent above — threads save automatically."
                  size="sm"
                />
              </SectionCard>
            ) : (
              <ul className="flex flex-col rounded-lg border bg-background px-3">
                {(sessions.data ?? []).map((row) => (
                  <SessionRowItem
                    key={row.id}
                    row={row}
                    agentName={agentName(row.agentId)}
                    onDelete={() => remove.mutate({ id: row.id })}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
        <section>
          <SectionHeading label="Shared with you" count={shared.data?.length ?? 0} />
          <div className="mt-3">
            {(shared.data ?? []).length === 0 ? (
              <SectionCard>
                <EmptyState
                  icon={Users}
                  title="Nothing shared yet"
                  body="Threads teammates share with you (or the whole workspace) land here."
                  size="sm"
                />
              </SectionCard>
            ) : (
              <ul className="flex flex-col rounded-lg border bg-background px-3">
                {(shared.data ?? []).map((row) => (
                  <SessionRowItem
                    key={row.id}
                    row={row}
                    agentName={agentName(row.agentId)}
                    shared
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ── Artifact gallery ── */}
      {gallery.length > 0 && (
        <section>
          <SectionHeading label="Composed dashboards" count={gallery.length} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map(({ row, artifact }) => (
              <ArtifactCard key={row.id} row={row} artifact={artifact} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 border-border border-b pb-2">
      <span className="font-semibold text-[10.5px] text-muted-foreground uppercase tracking-[0.12em]">
        {label}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
    </div>
  );
}

/* ── Agent card ─────────────────────────────────────────────────────────── */

function AgentCard({ agent }: { agent: AgentRow }) {
  return (
    <Link
      href={`/ai/chat/new?agent=${agent.id}`}
      className="group flex flex-col gap-2 rounded-lg border bg-background p-3.5 transition-all hover:border-[var(--accent-ring)] hover:shadow-xs"
    >
      <div className="flex items-center gap-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-card">
          <Bot className="size-4 text-link" />
        </div>
        <span className="min-w-0 flex-1 truncate font-medium text-sm">{agent.name}</span>
        {agent.isSystem && <Badge variant="outline">System</Badge>}
      </div>
      <p className="line-clamp-2 min-h-8 text-muted-foreground text-xs leading-relaxed">
        {agent.description || 'Chat with your data and compose live dashboards.'}
      </p>
      <span className="flex items-center gap-1 text-[11px] text-link opacity-0 transition-opacity group-hover:opacity-100">
        Start chat <ArrowUpRight className="size-3" />
      </span>
    </Link>
  );
}

/* ── Session row ────────────────────────────────────────────────────────── */

function SessionRowItem({
  row,
  agentName,
  shared,
  onDelete,
}: {
  row: SessionRow;
  agentName?: string;
  shared?: boolean;
  onDelete?: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 border-border/60 border-b py-2.5 last:border-b-0">
      <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/ai/chat/${row.id}`}
          className="block truncate font-medium text-sm hover:text-link"
        >
          {row.title}
        </Link>
        <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
          {agentName && (
            <>
              <span>{agentName}</span>
              <span>·</span>
            </>
          )}
          <span>{row.messages.length} messages</span>
          <span>·</span>
          <span>{timeAgo(row.updatedAt)}</span>
        </span>
      </div>
      {!shared && onDelete && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Delete chat"
          className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      )}
      <Button variant="ghost" size="icon-xs" aria-label={`Open ${row.title}`} asChild>
        <Link href={`/ai/chat/${row.id}`}>
          <ArrowUpRight />
        </Link>
      </Button>
    </li>
  );
}

/* ── Artifact gallery card ──────────────────────────────────────────────── */

function ArtifactCard({ row, artifact }: { row: SessionRow; artifact: ArtifactLike }) {
  const canSave = useCan('view.write');
  const saver = useSaveArtifactAsView();
  const [saveOpen, setSaveOpen] = useState(false);
  const title = artifactTitle(artifact) ?? row.title;
  const n = artifact.components.length;
  const prompts = row.messages.flatMap((m) =>
    (m.kind === 'text' || m.kind === undefined) && m.role === 'user' ? [m.content] : [],
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-3.5">
      <div className="flex items-center gap-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-card">
          <LayoutDashboard className="size-4 text-link" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm">{title}</span>
          <span className="block text-muted-foreground text-xs">
            {n} component{n === 1 ? '' : 's'} · {timeAgo(row.updatedAt)}
          </span>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <Button variant="outline" size="xs" asChild>
          <Link href={`/ai/chat/${row.id}`}>Open chat</Link>
        </Button>
        {canSave && (
          <Button variant="ghost" size="xs" className="text-link" onClick={() => setSaveOpen(true)}>
            <BookmarkPlus />
            Save as view
          </Button>
        )}
      </div>
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultLabel={title.slice(0, 60)}
        defaultIcon="chart"
        isSaving={saver.isSaving}
        onSave={async (opts) => {
          await saver.save({ artifact, ...opts, prompts, model: row.model });
          setSaveOpen(false);
        }}
      />
    </div>
  );
}
