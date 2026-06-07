'use client';

import type { Health } from '@/lib/mock-crm';
import { DEAL_STAGE_TONE, type DealStage } from '@/lib/tones';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../ui/button';
import { Icon } from './icons';
import { Badge } from './primitives';

export function StageTag({ stage }: { stage: DealStage }) {
  const tone = DEAL_STAGE_TONE[stage];
  return (
    <span className="stage" style={{ color: tone.color }}>
      <span className="dot" />
      <span style={{ color: 'var(--ink-secondary)' }}>{tone.label}</span>
    </span>
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
      {items.map((m) => (
        <div className="metric" key={m.label}>
          <div className="metric__label">{m.label}</div>
          <div className="metric__value">{m.value}</div>
          {m.delta && (
            <div className="metric__delta">
              <Badge variant={m.delta.tone}>{m.delta.text}</Badge>
            </div>
          )}
        </div>
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

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
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
      </aside>
    </div>,
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
