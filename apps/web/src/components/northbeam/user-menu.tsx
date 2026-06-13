'use client';

import { trpc } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Icon } from './icons';
import { Avatar, Popover } from './primitives';
import { ThemeToggle } from './theme-switcher';

export function UserMenu({
  name,
  email,
  compact = false,
}: {
  name: string | null;
  email: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const signOut = trpc.auth.signOut.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      router.replace('/sign-in');
    },
  });

  const display = name || email.split('@')[0] || email;

  return (
    <>
      <button
        type="button"
        ref={ref}
        className="sb__user"
        data-compact={compact ? 'true' : undefined}
        aria-label="Account menu"
        title={compact ? display : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={display} className="sb__avatar" />
        {!compact && (
          <>
            <div style={{ minWidth: 0, textAlign: 'left', flex: 1 }}>
              <div className="sb__user-name">{display}</div>
              <div className="sb__user-email">{email}</div>
            </div>
            <Icon name="caret-up-down" size={15} className="caret" />
          </>
        )}
      </button>

      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align="right" width={244}>
        <div className="usermenu__head">
          <Avatar name={display} className="sb__avatar" style={{ width: 36, height: 36 }} />
          <div style={{ minWidth: 0 }}>
            <div className="usermenu__name">{display}</div>
            <div className="usermenu__email">{email}</div>
          </div>
        </div>
        <div className="menu__sep" />
        <button
          type="button"
          className="menu__item"
          onClick={() => {
            setOpen(false);
            router.push('/settings');
          }}
        >
          <Icon name="user" />
          <span>Profile</span>
        </button>
        <button
          type="button"
          className="menu__item"
          onClick={() => {
            setOpen(false);
            router.push('/settings');
          }}
        >
          <Icon name="gear-six" />
          <span>Workspace settings</span>
        </button>
        <button type="button" className="menu__item" onClick={() => setOpen(false)}>
          <Icon name="keyboard" />
          <span>Keyboard shortcuts</span>
          <span className="menu__item-sub">⌘K</span>
        </button>
        <div className="menu__sep" />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px 6px',
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 'var(--text-sm)',
              color: 'var(--ink-secondary)',
              fontWeight: 'var(--fw-medium)',
            }}
          >
            Theme
          </span>
          <ThemeToggle />
        </div>
        <div className="menu__sep" />
        <button
          type="button"
          className="menu__item menu__item--danger"
          onClick={() => signOut.mutate()}
        >
          <Icon name="arrow-square-out" />
          <span>Sign out</span>
        </button>
      </Popover>
    </>
  );
}
