'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { IconButton } from '../ui/button';
import { Icon } from './icons';
import { Kbd } from './primitives';
import { ThemeToggle } from './theme-switcher';

export type Crumb = { label: string; href?: string };

export function AppTopbar({
  crumbs,
  onOpenSearch,
  onOpenMenu,
}: {
  crumbs: Crumb[];
  onOpenSearch: () => void;
  onOpenMenu: () => void;
}) {
  return (
    <header className="app-top">
      <span className="app-hamburger">
        <IconButton icon="sidebar-simple" label="Menu" onClick={onOpenMenu} />
      </span>
      <nav className="app-crumb">
        {crumbs.map((c, i) => (
          <Fragment key={c.label}>
            {i > 0 && (
              <span className="sep">
                <Icon name="caret-right" size={13} />
              </span>
            )}
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              <b>{c.label}</b>
            )}
          </Fragment>
        ))}
      </nav>
      <span className="app-top__spacer" />
      <button type="button" className="app-search" onClick={onOpenSearch}>
        <Icon name="magnifying-glass" size={15} />
        <span className="app-search__label">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <ThemeToggle />
    </header>
  );
}
