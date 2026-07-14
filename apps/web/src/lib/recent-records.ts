'use client';

// Recently-viewed records (localStorage, per browser) — feeds the Lightning-
// style nav-tab dropdowns and the ⌘K palette. Written by the shell's visit
// tracker; a window event keeps every consumer in sync without a store.

import { useCallback, useEffect, useState } from 'react';

export type RecentRecord = {
  objectKey: string;
  id: string;
  name: string;
  objectLabel: string;
  color?: string;
  at: number;
};

const KEY = 'nb.recent-records';
const CAP = 15;
const EVENT = 'nb:recents-changed';

function read(): RecentRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is RecentRecord =>
        r &&
        typeof r.objectKey === 'string' &&
        typeof r.id === 'string' &&
        typeof r.name === 'string',
    );
  } catch {
    return [];
  }
}

/** Prepend (dedupe on objectKey+id); no-op when already freshest with the
 *  same name — keeps the shell tracker's effect loop-free. */
export function touchRecent(rec: Omit<RecentRecord, 'at'>): void {
  const cur = read();
  const head = cur[0];
  if (head && head.objectKey === rec.objectKey && head.id === rec.id && head.name === rec.name) {
    return;
  }
  const next = [
    { ...rec, at: Date.now() },
    ...cur.filter((r) => !(r.objectKey === rec.objectKey && r.id === rec.id)),
  ].slice(0, CAP);
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}

export function useRecentRecords(): RecentRecord[] {
  const [recents, setRecents] = useState<RecentRecord[]>([]);
  const refresh = useCallback(() => setRecents(read()), []);
  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);
  return recents;
}
