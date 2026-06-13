'use client';

// Per-object view-mode preference (list vs grid), persisted to localStorage so
// it's stable across navigations. Keyed by objectKey ("contact", "account", …).

import { useEffect, useState } from 'react';

export type ViewMode = 'list' | 'grid';

const STORAGE_KEY = 'nb.view-mode';

function readAll(): Record<string, ViewMode> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, ViewMode>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function useViewMode(
  objectKey: string,
  fallback: ViewMode = 'list',
): [ViewMode, (next: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(fallback);

  useEffect(() => {
    const all = readAll();
    if (all[objectKey] === 'list' || all[objectKey] === 'grid') {
      setMode(all[objectKey]);
    } else {
      setMode(fallback);
    }
  }, [objectKey, fallback]);

  const set = (next: ViewMode) => {
    setMode(next);
    const all = readAll();
    all[objectKey] = next;
    writeAll(all);
  };

  return [mode, set];
}
