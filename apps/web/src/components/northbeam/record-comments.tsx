'use client';

// Comments tab on record pages — flat feed (composer on top, newest last),
// the Chatter-equivalent. Author or admin can delete.

import { Avatar } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import { Loader2, MessageSquare, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from './empty-state';

export function RecordComments({ objectKey, recordId }: { objectKey: string; recordId: string }) {
  const [draft, setDraft] = useState('');
  const utils = trpc.useUtils();
  const me = trpc.me.bootstrap.useQuery();
  const comments = trpc.comment.list.useQuery({ objectKey, recordId });

  const invalidate = () => utils.comment.list.invalidate({ objectKey, recordId });
  const create = trpc.comment.create.useMutation({ onSuccess: invalidate });
  const remove = trpc.comment.remove.useMutation({ onSuccess: invalidate });

  const submit = () => {
    const body = draft.trim();
    if (!body || create.isPending) return;
    create.mutate({ objectKey, recordId, body }, { onSuccess: () => setDraft('') });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-border bg-card p-4">
        <Textarea
          rows={3}
          placeholder="Write a comment… (⌘↵ to post)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
        />
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={submit} disabled={!draft.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            Comment
          </Button>
        </div>
      </div>

      {comments.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !comments.data?.length ? (
        <EmptyState
          icon={MessageSquare}
          size="sm"
          title="No comments yet"
          body="Start the conversation — comments are visible to everyone who can see this record."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {comments.data.map((c) => {
            const author = c.authorName || c.authorEmail || 'Former member';
            const mine = c.authorId != null && c.authorId === me.data?.session?.userId;
            return (
              <li key={c.id} className="group flex gap-3">
                <Avatar name={author} />
                <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-sm">{author}</span>
                    <RelativeTimeCard
                      date={c.createdAt}
                      className="text-muted-foreground text-xs"
                    />
                    <span className="flex-1" />
                    {mine && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="Delete comment"
                        onClick={() => remove.mutate({ id: c.id })}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-foreground text-sm">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
