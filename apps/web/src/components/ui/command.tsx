// Command palette (⌘K). Direct port of design_handoff_northbeam/lib-command.jsx
// onto the ported .cmdk CSS. Item data lives in @/lib/cmd-data.

'use client';

import { CMD_GROUP_ORDER, CMD_ITEMS, type CmdItem } from '@/lib/cmd-data';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../northbeam/icons';
import { Avatar, useDismiss } from '../northbeam/primitives';

export function CommandPalette({
  open,
  onClose,
  contained,
  onSelect,
}: {
  open: boolean;
  onClose?: () => void;
  contained?: boolean;
  onSelect?: (item: CmdItem) => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return CMD_ITEMS;
    return CMD_ITEMS.filter((it) => `${it.label} ${it.sub ?? ''}`.toLowerCase().includes(s));
  }, [q]);

  const grouped = useMemo(() => {
    const m: Record<string, CmdItem[]> = {};
    for (const it of filtered) {
      const list = m[it.group] ?? [];
      list.push(it);
      m[it.group] = list;
    }
    const blocks = CMD_GROUP_ORDER.filter((g) => m[g]).map((g) => ({
      group: g,
      items: m[g] as CmdItem[],
    }));
    const flat: CmdItem[] = [];
    for (const b of blocks) for (const it of b.items) flat.push(it);
    return { blocks, flat };
  }, [filtered]);

  const choose = (it: CmdItem) => {
    onSelect?.(it);
    onClose?.();
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, grouped.flat.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = grouped.flat[idx];
        if (it) choose(it);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, grouped.flat, idx, onClose]);

  const ref = useDismiss<HTMLDivElement>(open, () => onClose?.());
  if (!open) return null;

  let running = -1;
  return (
    <div
      className="cmdk-overlay"
      style={contained ? { position: 'absolute' } : { position: 'fixed' }}
    >
      <div className="cmdk" ref={ref}>
        <div className="cmdk__input">
          <Icon name="magnifying-glass" size={20} />
          {/* Command palettes focus their query field on open — intentional. */}
          <input
            autoFocus
            value={q}
            placeholder="Search or jump to…"
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk__scroll">
          {grouped.flat.length === 0 ? (
            <div className="cmdk__empty">
              <Icon name="magnifying-glass" size={30} />
              No results for “{q}”
            </div>
          ) : (
            grouped.blocks.map((b) => (
              <div key={b.group}>
                <div className="cmdk__group-label">{b.group}</div>
                {b.items.map((it) => {
                  running++;
                  const here = running;
                  return (
                    <div
                      key={it.id}
                      className="cmdk__item"
                      data-active={idx === here ? 'true' : undefined}
                      onMouseEnter={() => setIdx(here)}
                      onClick={() => choose(it)}
                    >
                      {it.avatar ? (
                        <Avatar name={it.label} className="cmdk__avatar" />
                      ) : (
                        <span className="cmdk__icon">
                          {it.icon && <Icon name={it.icon} size={17} />}
                        </span>
                      )}
                      <div className="cmdk__item-body">
                        {it.label}
                        {it.sub && <small>{it.sub}</small>}
                      </div>
                      <div className="cmdk__item-meta">
                        {it.meta && <span className="badge">{it.meta}</span>}
                        {it.kbd && <span style={{ fontSize: 'var(--text-sm)' }}>{it.kbd}</span>}
                        {idx === here && <Icon name="arrow-elbow-down-left" size={15} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="cmdk__footer">
          <span className="cmdk__footer-hint">
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> navigate
          </span>
          <span className="cmdk__footer-hint">
            <span className="kbd">↵</span> select
          </span>
          <span className="cmdk__footer-hint">
            <span className="kbd">esc</span> close
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="command" size={14} />
            Command palette
          </span>
        </div>
      </div>
    </div>
  );
}
