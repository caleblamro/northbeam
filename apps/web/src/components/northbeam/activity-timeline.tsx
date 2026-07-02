'use client';

// ActivityTimeline — turns a list of activity records into a DiceUI Timeline.
// Maps subtype → icon, formats createdAt as a relative time. Pages drop one
// element and pass the rows.

import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
} from '@/components/ui/timeline';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/time';
import {
  Calendar,
  CheckCircle2,
  type LucideIcon,
  Mail,
  NotebookPen,
  Phone,
  Zap,
} from 'lucide-react';
import type { ReactNode } from 'react';

const DEFAULT_ICONS: Record<string, LucideIcon> = {
  call: Phone,
  email: Mail,
  note: NotebookPen,
  meeting: Calendar,
  task: CheckCircle2,
};

export type ActivityRow = {
  id: string;
  name: ReactNode;
  createdAt: Date | string;
  subtype?: string | null;
};

// Compact relative-time formatting lives in @/lib/time — shared with the
// artifact walker's RecordList and the AI composer's session history.

interface ActivityTimelineProps {
  items: ActivityRow[];
  /** Optional override map of subtype → icon component. */
  icons?: Record<string, LucideIcon>;
  /** Optional override formatter for createdAt. */
  formatTime?: (date: Date | string) => string;
  className?: string;
}

export function ActivityTimeline({
  items,
  icons,
  formatTime = timeAgo,
  className,
}: ActivityTimelineProps) {
  return (
    <Timeline className={cn(className)}>
      {items.map((a, idx, arr) => {
        const IconCmp = (a.subtype && (icons?.[a.subtype] ?? DEFAULT_ICONS[a.subtype])) || Zap;
        return (
          <TimelineItem key={a.id}>
            <TimelineDot>
              <IconCmp />
            </TimelineDot>
            {idx < arr.length - 1 && <TimelineConnector />}
            <TimelineContent>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-foreground">{a.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {formatTime(a.createdAt)}
                </span>
              </div>
            </TimelineContent>
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}
