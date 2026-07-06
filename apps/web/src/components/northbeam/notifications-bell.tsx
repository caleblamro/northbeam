'use client';

// NotificationsBell — the topbar bell, backed by /trpc/notification (flow
// `notify` steps land here). Polls every 30s; unread badge, per-item +
// mark-all read, deep links via each notification's `link`.

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { trpc } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import { Bell, BellOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NotificationsBell() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const q = trpc.notification.list.useQuery(
    { limit: 30, offset: 0, unreadOnly: false },
    { refetchInterval: 30_000 },
  );
  const invalidate = () => utils.notification.list.invalidate();
  const markRead = trpc.notification.markRead.useMutation({ onSuccess: invalidate });
  const markAllRead = trpc.notification.markAllRead.useMutation({ onSuccess: invalidate });

  const items = q.data?.items ?? [];
  const unread = q.data?.unreadCount ?? 0;

  const openItem = (item: (typeof items)[number]) => {
    if (!item.readAt) markRead.mutate({ ids: [item.id] });
    if (item.link) {
      setOpen(false);
      if (item.link.startsWith('/')) router.push(item.link);
      else window.open(item.link, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications" className="relative">
          <Bell />
          {unread > 0 && (
            <span
              aria-label={`${unread} unread notifications`}
              className="-top-0.5 -right-0.5 absolute grid h-3.5 min-w-3.5 place-items-center rounded-full px-0.5 font-medium text-[9px] text-white tabular-nums"
              style={{ background: 'var(--danger)' }}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <span className="font-medium text-sm">Notifications</span>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              Mark all read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
            <BellOff className="size-5" />
            <span className="text-sm">You're all caught up.</span>
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <ul className="flex flex-col py-1">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/60"
                    onClick={() => openItem(item)}
                  >
                    <span
                      className="mt-1.5 size-1.5 shrink-0 rounded-full"
                      style={{ background: item.readAt ? 'transparent' : 'var(--accent)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-sm">{item.title}</span>
                      {item.body && (
                        <span className="mt-0.5 line-clamp-2 block text-muted-foreground text-xs">
                          {item.body}
                        </span>
                      )}
                      <span className="mt-0.5 block text-muted-foreground text-xs">
                        {timeAgo(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
