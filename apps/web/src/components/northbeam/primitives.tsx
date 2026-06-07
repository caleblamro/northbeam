// Shared design primitives. Direct port of design_handoff_northbeam/lib-primitives.jsx
// (Popover, Avatar, Spinner, roving-index + dismiss hooks) plus the brand
// chip/logo/badge atoms. Uses the ported CSS classes + CSS variables for fidelity.

'use client';

import { BRAND } from '@northbeam/config';
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/* ── close on outside click + Escape ─────────────────────────────────────── */
export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

export function Spinner({ style }: { style?: CSSProperties }) {
  return <span className="spinner" style={style} aria-hidden="true" />;
}

/* ── Popover: portals a positioned panel to <body> so it never gets clipped ── */
type PopoverProps = {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose?: () => void;
  align?: 'left' | 'right';
  matchWidth?: boolean;
  width?: number;
  gap?: number;
  children: ReactNode;
};

export function Popover({
  anchorRef,
  open,
  onClose,
  align = 'left',
  matchWidth,
  width,
  gap = 6,
  children,
}: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<CSSProperties>({
    position: 'fixed',
    top: -9999,
    left: -9999,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchorRef.current;
      const pop = popRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      const ph = pop ? pop.offsetHeight : 0;
      let top = r.bottom + gap;
      if (top + ph > window.innerHeight - 8 && r.top - gap - ph > 8) top = r.top - gap - ph;
      const s: CSSProperties = { position: 'fixed', top, zIndex: 1000, visibility: 'visible' };
      if (matchWidth) {
        s.left = r.left;
        s.minWidth = r.width;
      } else if (align === 'right') {
        s.left = Math.max(8, r.right - (width || (pop ? pop.offsetWidth : 210)));
      } else {
        s.left = r.left;
      }
      if (width) s.width = width;
      setSt(s);
    };
    place();
    const h = () => place();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('scroll', h, true);
      window.removeEventListener('resize', h);
    };
  }, [open, align, gap, matchWidth, width, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const a = anchorRef.current;
      const p = popRef.current;
      if (p && !p.contains(e.target as Node) && a && !a.contains(e.target as Node)) onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={popRef}
      className={`menu ${align === 'right' ? 'menu--right' : ''}`}
      style={st}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}

/* ── deterministic avatar color from a string ────────────────────────────── */
const AVATAR_COLORS = [
  '#635bff',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] as string;
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
}

export function Avatar({
  name,
  className,
  style,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={className} style={{ background: avatarColor(name), ...style }}>
      {initials(name)}
    </span>
  );
}

/* ── roving keyboard selection for menus/lists ───────────────────────────── */
export function useRovingIndex(length: number, open: boolean) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (open) setIdx(0);
  }, [open, length]);
  const onKey = useCallback(
    (e: KeyboardEvent, onEnter?: (i: number) => void) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onEnter?.(idx);
      }
    },
    [length, idx],
  );
  return [idx, setIdx, onKey] as const;
}

/* ── Brand chip (gradient square) — matches .sb__logo / .toc__logo ───────── */
export function BrandChip({ letter = 'N', size = 30 }: { letter?: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size > 32 ? 9 : 8,
        background:
          'linear-gradient(150deg, var(--brand), color-mix(in srgb, var(--brand) 52%, #12cabc))',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        fontWeight: 700,
        fontSize: size > 32 ? 17 : 15,
        boxShadow: 'var(--shadow-sm)',
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

/* ── Logo (the beam monogram) + Wordmark ─────────────────────────────────── */
export function Logo({ size = 18, color = 'var(--brand)' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox={BRAND.logo.viewBox} aria-hidden="true">
      {BRAND.logo.paths.map((p) => (
        <path
          key={p.d}
          d={p.d}
          stroke={color}
          strokeWidth={p.strokeWidth}
          fill={p.fill}
          strokeLinecap={p.strokeLinecap}
        />
      ))}
    </svg>
  );
}

export function Wordmark({ size = 16 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <BrandChip size={size + 14} />
      <span style={{ fontWeight: 600, fontSize: size, letterSpacing: '-0.01em' }}>
        {BRAND.name}
      </span>
    </div>
  );
}

/* ── Badge + Kbd atoms ───────────────────────────────────────────────────── */
export function Badge({
  children,
  variant,
  dot,
}: {
  children: ReactNode;
  variant?: 'brand' | 'success' | 'warning' | 'danger';
  dot?: boolean;
}) {
  return (
    <span className={`badge ${variant ? `badge--${variant}` : ''}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function Kbd({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="kbd" style={style}>
      {children}
    </span>
  );
}
