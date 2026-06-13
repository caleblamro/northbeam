'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'nb.pinned-tabs';

export type PinnedTab = {
  href: string;
  label: string;
  icon: string;
};

export const DEFAULT_PINS: PinnedTab[] = [
  { href: '/', label: 'Home', icon: 'house' },
  { href: '/accounts', label: 'Accounts', icon: 'buildings' },
  { href: '/contacts', label: 'Contacts', icon: 'users-three' },
  { href: '/deals', label: 'Deals', icon: 'currency-circle-dollar' },
  { href: '/activities', label: 'Activities', icon: 'lightning' },
  { href: '/pipeline', label: 'Pipeline', icon: 'funnel' },
];

function read(): PinnedTab[] {
  if (typeof window === 'undefined') return DEFAULT_PINS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PINS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_PINS;
    return parsed.filter(
      (p): p is PinnedTab =>
        p &&
        typeof p.href === 'string' &&
        typeof p.label === 'string' &&
        typeof p.icon === 'string',
    );
  } catch {
    return DEFAULT_PINS;
  }
}

function write(tabs: PinnedTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {}
}

// Home is always pinned and always first — matches Lightning. Other tabs are
// user-managed via the App Launcher (click a tile → pin; click x on a tab → unpin).
export function usePinnedTabs() {
  const [tabs, setTabs] = useState<PinnedTab[]>(DEFAULT_PINS);

  useEffect(() => {
    setTabs(read());
  }, []);

  const pin = (tab: PinnedTab) => {
    setTabs((cur) => {
      if (cur.some((t) => t.href === tab.href)) return cur;
      const next = [...cur, tab];
      write(next);
      return next;
    });
  };

  const unpin = (href: string) => {
    if (href === '/') return;
    setTabs((cur) => {
      const next = cur.filter((t) => t.href !== href);
      write(next);
      return next;
    });
  };

  const isPinned = (href: string) => tabs.some((t) => t.href === href);

  return { tabs, pin, unpin, isPinned };
}
