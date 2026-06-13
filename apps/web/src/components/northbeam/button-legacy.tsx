// Buttons. Direct port of design_handoff_northbeam/lib-buttons.jsx — Button,
// IconButton, Menu, SplitButton, MenuButton — onto the ported .btn/.icon-btn/
// .split/.menu CSS classes. Treatment (flat/elevated/soft) is set by a
// `treat-*` ancestor class (see globals → components.css).

'use client';

import { cn } from '@/lib/cn';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../northbeam/icons';
import { Popover, Spinner, useRovingIndex } from '../northbeam/primitives';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  block?: boolean;
  children?: ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  icon,
  iconRight,
  block,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'btn',
        `btn--${variant}`,
        size !== 'md' && `btn--${size}`,
        block && 'btn--block',
        className,
      )}
      data-loading={loading ? 'true' : undefined}
      disabled={disabled}
      {...rest}
    >
      {loading && (
        <span className="btn__spinner">
          <Spinner />
        </span>
      )}
      {icon && <Icon name={icon} />}
      {children != null && <span className="btn__label">{children}</span>}
      {iconRight && <Icon name={iconRight} />}
    </button>
  );
}

type IconButtonProps = {
  icon: IconName;
  size?: ButtonSize;
  variant?: '' | 'bordered' | 'solid';
  active?: boolean;
  label: string;
  fill?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

export function IconButton({
  icon,
  size = 'md',
  variant = '',
  active,
  label,
  fill,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'icon-btn',
        size !== 'md' && `icon-btn--${size}`,
        variant && `icon-btn--${variant}`,
        className,
      )}
      data-active={active ? 'true' : undefined}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} fill={fill} size={20} />
    </button>
  );
}

export type MenuItem = {
  icon?: IconName;
  label?: string;
  shortcut?: string;
  danger?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  separator?: boolean;
  heading?: string;
};

export function Menu({ items, onClose }: { items: MenuItem[]; onClose?: () => void }) {
  const real = items.filter((it) => !it.separator && !it.heading);
  const [idx, setIdx, onKey] = useRovingIndex(real.length, true);
  const select = (it: MenuItem) => {
    it.onSelect?.();
    onClose?.();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        onKey(e, (i) => {
          const it = real[i];
          if (it) select(it);
        });
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onKey, real, select]);

  let ri = -1;
  return (
    <>
      {items.map((it, i) => {
        if (it.separator) return <div className="menu__sep" key={`s${i}`} />;
        if (it.heading)
          return (
            <div className="menu__label" key={`h${i}`}>
              {it.heading}
            </div>
          );
        ri++;
        const here = ri;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={cn('menu__item', it.danger && 'menu__item--danger')}
            data-active={idx === here ? 'true' : undefined}
            onMouseEnter={() => setIdx(here)}
            onClick={() => select(it)}
          >
            {it.icon && <Icon name={it.icon} />}
            <span>{it.label}</span>
            {it.shortcut && <span className="menu__item-sub">{it.shortcut}</span>}
            {it.checked && <Icon name="check" className="menu__item-check" />}
          </button>
        );
      })}
    </>
  );
}

export function SplitButton({
  children,
  onClick,
  items,
  variant = 'primary',
  size = 'md',
  icon,
  align = 'right',
}: {
  children: ReactNode;
  onClick?: () => void;
  items: MenuItem[];
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  return (
    <div
      className={cn('split', `split--${variant}`, size !== 'md' && `split--${size}`)}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      <Button variant={variant} size={size} icon={icon} onClick={onClick}>
        {children}
      </Button>
      <button
        type="button"
        ref={caretRef}
        className={cn('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, 'split__caret')}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="caret-down" />
      </button>
      <Popover
        anchorRef={caretRef}
        open={open}
        onClose={() => setOpen(false)}
        align={align}
        width={210}
      >
        <Menu items={items} onClose={() => setOpen(false)} />
      </Popover>
    </div>
  );
}

export function MenuButton({
  children,
  items,
  variant = 'secondary',
  size = 'md',
  icon,
  caret = true,
  align = 'left',
  iconBtn,
  iconBtnVariant,
}: {
  children?: ReactNode;
  items: MenuItem[];
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  caret?: boolean;
  align?: 'left' | 'right';
  iconBtn?: IconName;
  iconBtnVariant?: '' | 'bordered' | 'solid';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ display: 'inline-flex' }}>
      {iconBtn ? (
        <IconButton
          icon={iconBtn}
          variant={iconBtnVariant}
          active={open}
          label="Actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
      ) : (
        <Button
          variant={variant}
          size={size}
          icon={icon}
          iconRight={caret ? 'caret-down' : undefined}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {children}
        </Button>
      )}
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align={align} width={210}>
        <Menu items={items} onClose={() => setOpen(false)} />
      </Popover>
    </div>
  );
}
