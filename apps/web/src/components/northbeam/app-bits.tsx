'use client';

import type { Health } from '@/lib/mock-crm';
import { DEAL_STAGE_TONE, type DealStage } from '@/lib/tones';
import { AnimatePresence, motion } from 'framer-motion';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../ui/button';
import { Icon } from './icons';
import { Badge } from './primitives';

export function StageTag({ stage }: { stage: DealStage }) {
  const tone = DEAL_STAGE_TONE[stage];
  return (
    <span className="chip" style={{ background: tone.bg, color: tone.fg }}>
      {tone.label}
    </span>
  );
}

export function SourceChip({ source, external }: { source: string; external?: boolean }) {
  return (
    <span className="chip-src">
      {source}
      {external && <Icon name="arrow-square-out" size={11} />}
    </span>
  );
}

export type ProbLevel = 'low' | 'mid' | 'high';
const PROB: Record<ProbLevel, { label: string; fg: string; bg: string; n: number }> = {
  low: { label: 'Low', fg: 'var(--danger)', bg: 'var(--danger-bg)', n: 1 },
  mid: { label: 'Mid', fg: 'var(--warning)', bg: 'var(--warning-bg)', n: 2 },
  high: { label: 'High', fg: 'var(--success)', bg: 'var(--success-bg)', n: 3 },
};

export function ProbabilityChip({ level }: { level: ProbLevel }) {
  const p = PROB[level];
  return (
    <span className="prob" style={{ background: p.bg, color: p.fg }}>
      <span className="prob__bars">
        {[0, 1, 2].map((i) => (
          <i key={i} className={i < p.n ? '' : 'off'} style={{ height: `${4 + i * 3}px` }} />
        ))}
      </span>
      {p.label}
    </span>
  );
}

/** Tiny line chart for the "interest" trend column. */
export function Sparkline({ data }: { data: number[] }) {
  const w = 66;
  const h = 22;
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const last = data[data.length - 1] ?? 0;
  const first = data[0] ?? 0;
  const pts = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((v - min) / range) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const color = last >= first ? 'var(--success)' : 'var(--danger)';
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Cbx({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className="cbx"
      data-checked={checked ? 'true' : undefined}
      aria-label={checked ? 'Deselect' : 'Select'}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
    >
      {checked && <Icon name="check" size={11} />}
    </button>
  );
}

export function HealthDot({ health, label }: { health: Health; label?: boolean }) {
  const text = health === 'good' ? 'Healthy' : health === 'warn' ? 'At risk' : 'Critical';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span className={`hdot hdot--${health}`} />
      {label && <span style={{ color: 'var(--ink-secondary)' }}>{text}</span>}
    </span>
  );
}

export type Metric = {
  label: string;
  value: ReactNode;
  delta?: { text: string; tone?: 'brand' | 'success' | 'warning' | 'danger' };
};

export function MetricStrip({ items }: { items: Metric[] }) {
  return (
    <div className="metrics">
      {items.map((m, i) => (
        <motion.div
          className="metric"
          key={m.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="metric__label">{m.label}</div>
          <div className="metric__value">{m.value}</div>
          {m.delta && (
            <div className="metric__delta">
              <Badge variant={m.delta.tone}>{m.delta.text}</Badge>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}
export function ToolbarSpacer() {
  return <span className="toolbar__spacer" />;
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="toolbar-search">
      <Icon name="magnifying-glass" size={16} />
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SegTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          className="tab"
          data-active={value === o.value ? 'true' : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count != null && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ViewToggle({
  value,
  onChange,
}: {
  value: 'table' | 'grid';
  onChange: (v: 'table' | 'grid') => void;
}) {
  return (
    <div className="viewtog">
      <button
        type="button"
        data-active={value === 'table' ? 'true' : undefined}
        aria-label="Table view"
        onClick={() => onChange('table')}
      >
        <Icon name="list-bullets" size={16} />
      </button>
      <button
        type="button"
        data-active={value === 'grid' ? 'true' : undefined}
        aria-label="Grid view"
        onClick={() => onChange('grid')}
      >
        <Icon name="squares-four" size={16} />
      </button>
    </div>
  );
}

export function RecordDrawer({
  open,
  onClose,
  title,
  subtitle,
  avatar,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  avatar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="drawer-overlay"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.aside
            className="drawer"
            onClick={(e) => e.stopPropagation()}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <div className="drawer__head">
              {avatar}
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
              </div>
              <IconButton icon="x" label="Close" onClick={onClose} />
            </div>
            <div className="drawer__body">{children}</div>
            {footer && <div className="drawer__foot">{footer}</div>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function KVList({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((it) => (
        <div key={it.k} style={{ display: 'contents' }}>
          <dt>{it.k}</dt>
          <dd>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
