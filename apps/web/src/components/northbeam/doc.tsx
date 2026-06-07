// Gallery documentation chrome. Ported from design_handoff_northbeam/
// components-doc.css + app-sections-*.jsx — the Section / Frame / SegToggle /
// Swatch building blocks the /system page composes.

'use client';

import { type CSSProperties, type ReactNode, useLayoutEffect, useState } from 'react';

export function Section({
  id,
  eyebrow,
  title,
  desc,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  desc?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section" id={id}>
      <div className="section__head">
        {eyebrow && <div className="section__eyebrow">{eyebrow}</div>}
        <h2 className="section__title">{title}</h2>
        {desc && <p className="section__desc">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

export function Frame({
  title,
  hint,
  tag,
  bodyClass,
  bodyStyle,
  children,
}: {
  title?: string;
  hint?: ReactNode;
  tag?: ReactNode;
  bodyClass?: string;
  bodyStyle?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="frame">
      {(title || hint || tag) && (
        <div className="frame__bar">
          {title && <h4>{title}</h4>}
          {hint && <p>{hint}</p>}
          {tag && <span className="frame__tag">{tag}</span>}
        </div>
      )}
      <div className={`frame__body ${bodyClass ?? ''}`} style={bodyStyle}>
        {children}
      </div>
    </div>
  );
}

export function SegToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="theme-toggle" style={{ borderRadius: 'var(--radius-md)' }}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          data-active={value === o.value ? 'true' : undefined}
          style={{ width: 'auto', padding: '0 12px', fontSize: 'var(--text-sm)', fontWeight: 500 }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Live-reads a CSS custom property so swatches reflect the active theme/accent. */
export function useVarValue(name: string, dep?: unknown): string {
  const [v, setV] = useState('');
  useLayoutEffect(() => {
    const read = () =>
      setV(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    read();
    const t = setTimeout(read, 40);
    return () => clearTimeout(t);
  }, [name, dep]);
  return v;
}

export function Swatch({ token, name, dep }: { token: string; name: string; dep?: unknown }) {
  const val = useVarValue(token, dep);
  return (
    <div className="swatch">
      <div
        className="swatch__chip"
        style={{ background: `var(${token})`, borderBottom: '1px solid var(--border)' }}
      />
      <div className="swatch__meta">
        <div className="swatch__name">{name}</div>
        <div className="swatch__val">{val || token}</div>
      </div>
    </div>
  );
}
