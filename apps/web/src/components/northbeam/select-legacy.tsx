// Dropdowns. Direct port of design_handoff_northbeam/lib-dropdowns.jsx —
// NativeSelect, custom Select, and the debounced async Combobox — onto the
// ported .select-wrap / .combo / .menu CSS.

'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../northbeam/icons';
import { Avatar, Popover, Spinner } from '../northbeam/primitives';

export type Option = {
  value: string;
  label: string;
  sublabel?: string;
  color?: string;
  icon?: IconName;
  avatar?: boolean;
};

export function NativeSelect({
  value,
  onChange,
  options,
  size,
  disabled,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: { value: string; label: string }[];
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}) {
  return (
    <div className={`select-wrap ${size && size !== 'md' ? `select-wrap--${size}` : ''}`}>
      <select value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="select-wrap__chevron">
        <Icon name="caret-down" size={16} />
      </span>
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  size,
  disabled,
  leadIcon,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: Option[];
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  leadIcon?: IconName;
}) {
  const [open, setOpen] = useState(false);
  const ctrlRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <div className="combo">
      <button
        type="button"
        ref={ctrlRef}
        className="combo__control"
        data-open={open ? 'true' : undefined}
        disabled={disabled}
        style={
          size === 'sm'
            ? { height: 'var(--h-sm)' }
            : size === 'lg'
              ? { height: 'var(--h-lg)' }
              : undefined
        }
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {leadIcon && <Icon name={leadIcon} size={16} />}
        {current?.color && (
          <span style={{ width: 8, height: 8, borderRadius: 99, background: current.color }} />
        )}
        <span className={`combo__value ${current ? '' : 'combo__value--empty'}`}>
          {current ? current.label : placeholder}
        </span>
        <Icon name="caret-down" className="combo__chev" size={16} />
      </button>
      <Popover anchorRef={ctrlRef} open={open} onClose={() => setOpen(false)} matchWidth>
        <div className="menu__scroll">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="menu__item"
              data-active={o.value === value ? 'true' : undefined}
              onClick={() => {
                onChange?.(o.value);
                setOpen(false);
              }}
            >
              {o.icon && <Icon name={o.icon} />}
              {o.color && (
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 99,
                    background: o.color,
                    flexShrink: 0,
                  }}
                />
              )}
              <span className="menu__two-line">
                {o.label}
                {o.sublabel && <small>{o.sublabel}</small>}
              </span>
              {o.value === value && <Icon name="check" className="menu__item-check" />}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

export function Combobox({
  value,
  onChange,
  loadOptions,
  placeholder = 'Search…',
  emptyText = 'No matches',
  minChars = 0,
  renderOption,
}: {
  value: Option | null;
  onChange?: (o: Option | null) => void;
  loadOptions: (q: string) => Promise<Option[]>;
  placeholder?: string;
  emptyText?: string;
  minChars?: number;
  renderOption?: (o: Option) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const ctrlRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (q.length < minChars) {
      setOpts([]);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      const r = await loadOptions(q);
      if (id === reqId.current) {
        setOpts(r);
        setLoading(false);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [q, open, minChars, loadOptions]);

  return (
    <div className="combo">
      <div
        className="combo__control"
        ref={ctrlRef}
        data-open={open ? 'true' : undefined}
        onClick={() => setOpen(true)}
      >
        <Icon name="magnifying-glass" size={16} />
        {open ? (
          // Focuses the search field when the combobox opens — intentional.
          <input
            autoFocus
            value={q}
            placeholder={placeholder}
            onChange={(e) => setQ(e.target.value)}
          />
        ) : (
          <span className={`combo__value ${value ? '' : 'combo__value--empty'}`}>
            {value ? value.label : placeholder}
          </span>
        )}
        {value && !open && (
          <button
            type="button"
            className="input-wrap__icon"
            style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              onChange?.(null);
            }}
          >
            <Icon name="x" size={16} />
          </button>
        )}
        <Icon name="caret-down" className="combo__chev" size={16} />
      </div>
      <Popover
        anchorRef={ctrlRef}
        open={open}
        onClose={() => {
          setOpen(false);
          setQ('');
        }}
        matchWidth
      >
        <div className="menu__scroll">
          {loading ? (
            <div className="menu__loading">
              <Spinner />
              Searching…
            </div>
          ) : q.length < minChars ? (
            <div className="menu__empty">Type at least {minChars} characters</div>
          ) : opts.length === 0 ? (
            <div className="menu__empty">{emptyText}</div>
          ) : (
            opts.map((o) => (
              <button
                key={o.value}
                type="button"
                className="menu__item"
                data-active={value?.value === o.value ? 'true' : undefined}
                onClick={() => {
                  onChange?.(o);
                  setOpen(false);
                  setQ('');
                }}
              >
                {renderOption ? (
                  renderOption(o)
                ) : (
                  <>
                    {o.avatar && <Avatar name={o.label} className="menu__avatar" />}
                    <span className="menu__two-line">
                      {o.label}
                      {o.sublabel && <small>{o.sublabel}</small>}
                    </span>
                  </>
                )}
                {value?.value === o.value && <Icon name="check" className="menu__item-check" />}
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  );
}
