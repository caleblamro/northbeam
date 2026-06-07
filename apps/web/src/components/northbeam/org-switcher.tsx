'use client';

import { trpc } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Icon } from './icons';
import { Avatar, Popover } from './primitives';

export function OrgSwitcher({
  activeName,
  compact = false,
}: { activeName: string; compact?: boolean }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const orgs = trpc.org.list.useQuery(undefined, { enabled: open });
  const setActive = trpc.org.setActive.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      setOpen(false);
    },
  });

  return (
    <>
      <button
        type="button"
        ref={ref}
        className="sb__org"
        data-compact={compact ? 'true' : undefined}
        title={compact ? activeName : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar
          name={activeName}
          className="sb__avatar"
          style={{ width: 30, height: 30, borderRadius: 8, fontSize: 12 }}
        />
        {!compact && (
          <>
            <div style={{ minWidth: 0 }}>
              <div className="sb__org__name">{activeName}</div>
              <div className="sb__org__sub">Workspace</div>
            </div>
            <Icon name="caret-up-down" size={15} className="caret" />
          </>
        )}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} matchWidth>
        <div className="menu__scroll">
          <div className="menu__label">Workspaces</div>
          {(orgs.data ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              className="menu__item"
              data-active={o.name === activeName ? 'true' : undefined}
              onClick={() => setActive.mutate({ organizationId: o.id })}
            >
              <Avatar
                name={o.name}
                className="menu__avatar"
                style={{ width: 22, height: 22, borderRadius: 5, fontSize: 9 }}
              />
              <span className="menu__two-line">
                {o.name}
                <small>{o.role}</small>
              </span>
              {o.name === activeName && <Icon name="check" className="menu__item-check" />}
            </button>
          ))}
          <div className="menu__sep" />
          <button
            type="button"
            className="menu__item"
            onClick={() => {
              setOpen(false);
              router.push('/create-org');
            }}
          >
            <Icon name="plus" />
            <span>Create workspace</span>
          </button>
        </div>
      </Popover>
    </>
  );
}
