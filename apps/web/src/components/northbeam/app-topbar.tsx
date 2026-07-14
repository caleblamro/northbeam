'use client';

// Single-row app shell bar — Salesforce Lightning-style consolidated chrome:
// App Launcher · Org switcher (sole org identity) · pinnable object tabs ·
// global search · ❓ 🔔 user menu. Theme controls live inside the user menu
// popover (not on the topbar itself).

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import { isNavActive } from '@/lib/nav';
import { usePinnedTabs } from '@/lib/pinned-tabs';
import { HelpCircle, Search, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { AppLauncher } from './app-launcher';
import { Icon } from './icons';
import { NotificationsBell } from './notifications-bell';
import { OrgSwitcher } from './org-switcher';
import { Kbd } from './primitives';
import { TabMenu, tabObjectKey } from './tab-menu';
import { UserMenu } from './user-menu';

export function AppTopbar({
  orgName,
  userName,
  userEmail,
  onOpenSearch,
}: {
  orgName: string;
  userName: string | null;
  userEmail: string;
  onOpenSearch: () => void;
}) {
  const pathname = usePathname();
  const { tabs, unpin } = usePinnedTabs();
  // Object keys for tab→object resolution (drives the Lightning-style tab
  // menus). Cached org-wide; cheap.
  const objects = trpc.object.list.useQuery();
  const objectKeys = useMemo(() => new Set((objects.data ?? []).map((o) => o.key)), [objects.data]);

  return (
    <header className="shellbar">
      <AppLauncher />
      <div className="shellbar__org">
        <OrgSwitcher activeName={orgName} compact={false} />
      </div>
      <div className="shellbar__divider" aria-hidden="true" />
      <nav className="shellbar__tabs" aria-label="Workspace tabs">
        {tabs.map((tab) => {
          const active = isNavActive(
            { label: tab.label, href: tab.href, icon: tab.icon },
            pathname,
          );
          const menuObjectKey = tabObjectKey(tab.href, objectKeys);
          return (
            <div key={tab.href} className="shelltab-cell" data-active={active ? 'true' : undefined}>
              <Link href={tab.href} className="shelltab">
                <Icon name={tab.icon} size={15} />
                <span>{tab.label}</span>
              </Link>
              {menuObjectKey && (
                <TabMenu href={tab.href} objectKey={menuObjectKey} label={tab.label} />
              )}
              {tab.href !== '/' && (
                <button
                  type="button"
                  className="shelltab__close"
                  aria-label={`Unpin ${tab.label}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    unpin(tab.href);
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
      </nav>
      <button type="button" className="shellbar__search" onClick={onOpenSearch}>
        <Search size={15} />
        <span>Search…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="shellbar__actions">
        <Button variant="ghost" size="icon-sm" aria-label="Help">
          <HelpCircle />
        </Button>
        <NotificationsBell />
        <UserMenu name={userName} email={userEmail} compact />
      </div>
    </header>
  );
}
