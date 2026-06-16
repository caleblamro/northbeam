'use client';

// Salesforce-style App Launcher: 9-dot waffle button → popover with a searchable
// tile grid grouped by section. Tiles are click-to-navigate; the small pin icon
// in the corner toggles whether the tile shows up in the top tabs row.

import { LAUNCHER_TILES, type NavItem } from '@/lib/nav';
import { type PinnedTab, usePinnedTabs } from '@/lib/pinned-tabs';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { Popover } from './primitives';

// 9-dot waffle — drawn inline so it reads as a true Salesforce affordance rather
// than a generic grid icon. Each dot is currentColor; the parent button sets it.
function WaffleGlyph({ size = 18 }: { size?: number }) {
  const d = size / 9;
  const positions: Array<[number, number]> = [
    [d, d],
    [d * 4.5, d],
    [d * 8, d],
    [d, d * 4.5],
    [d * 4.5, d * 4.5],
    [d * 8, d * 4.5],
    [d, d * 8],
    [d * 4.5, d * 8],
    [d * 8, d * 8],
  ];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {positions.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={d * 0.7} fill="currentColor" />
      ))}
    </svg>
  );
}

export function AppLauncher() {
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { isPinned, pin, unpin } = usePinnedTabs();

  // Focus the search on open — same pattern as a ⌘K palette. Via effect (not
  // autoFocus) so focus only moves when the user explicitly invoked the launcher.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return LAUNCHER_TILES;
    return LAUNCHER_TILES.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.label.toLowerCase().includes(needle)),
    })).filter((s) => s.items.length > 0);
  }, [q]);

  const go = (item: NavItem) => {
    setOpen(false);
    setQ('');
    router.push(item.href);
  };

  const togglePin = (e: React.MouseEvent, item: NavItem) => {
    e.stopPropagation();
    if (isPinned(item.href)) {
      unpin(item.href);
    } else {
      const tab: PinnedTab = { href: item.href, label: item.label, icon: item.icon };
      pin(tab);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={ref}
        className="launcher-btn"
        aria-label="App Launcher"
        title="App Launcher"
        onClick={() => setOpen((v) => !v)}
        data-open={open ? 'true' : undefined}
      >
        <WaffleGlyph size={18} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width={420}>
        <div className="launcher">
          <div className="launcher__search">
            <Icon name="magnifying-glass" size={15} />
            <input
              ref={inputRef}
              type="text"
              placeholder="Find an app or page…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button
                type="button"
                className="launcher__search-clear"
                onClick={() => setQ('')}
                aria-label="Clear search"
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </div>
          <div className="launcher__scroll">
            {sections.map((section) => (
              <div className="launcher__group" key={section.label}>
                <div className="launcher__group-label">{section.label}</div>
                <div className="launcher__grid">
                  {section.items.map((item) => {
                    const pinned = isPinned(item.href);
                    return (
                      // Wrapper div replaces the previous `<button>` so the
                      // pin toggle can live as a sibling instead of a nested
                      // `<button>` (invalid HTML → React hydration error).
                      // The wrapper carries the data-accent so the existing
                      // `.launcher__tile[data-accent="true"] .launcher__tile-ic`
                      // styling still cascades to the inner tile.
                      <div
                        key={item.href}
                        className="launcher__tile-cell"
                        data-accent={item.accent ? 'true' : undefined}
                      >
                        <button
                          type="button"
                          className="launcher__tile"
                          data-accent={item.accent ? 'true' : undefined}
                          onClick={() => go(item)}
                        >
                          <span className="launcher__tile-ic">
                            <Icon name={item.icon} size={20} />
                          </span>
                          <span className="launcher__tile-label">{item.label}</span>
                        </button>
                        <button
                          type="button"
                          className="launcher__tile-pin"
                          data-pinned={pinned ? 'true' : undefined}
                          aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                          onClick={(e) => togglePin(e, item)}
                        >
                          <Icon name={pinned ? 'pin' : 'pin-off'} size={12} fill={pinned} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {sections.length === 0 && <div className="launcher__empty">No apps match "{q}".</div>}
          </div>
        </div>
      </Popover>
    </>
  );
}
