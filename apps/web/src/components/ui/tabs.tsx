'use client';

// Minimal Tabs primitive — wraps Radix Tabs with a quiet underline indicator.
// No pill background, no surrounding border on the list. The active tab is
// indicated by ink-colored text + a hairline underline; focus draws the
// accent ring. Pattern mirrors components/ui/select.tsx.

import { Tabs as TabsPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/cn';

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex h-9 items-center gap-5 border-border border-b', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex h-9 shrink-0 select-none items-center gap-1.5 whitespace-nowrap pb-2 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:text-foreground',
        // The underline indicator: a 2px line that appears under the active
        // trigger and sits flush with the parent TabsList border. Uses --ink
        // (near-black) so it reads as authoritative, not chromatic.
        "after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-[2px] after:scale-x-0 after:bg-foreground after:transition-transform after:content-['']",
        'data-[state=active]:after:scale-x-100',
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
