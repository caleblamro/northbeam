'use client';

// Single-row app shell bar — Salesforce Lightning-style consolidated chrome:
// App Launcher · Org switcher (sole org identity) · pinnable object tabs ·
// global search · ❓ 🔔 user menu. Theme controls live inside the user menu
// popover (not on the topbar itself).

import { IconButton } from '@/components/northbeam/button-legacy';
import { isNavActive } from '@/lib/nav';
import { usePinnedTabs } from '@/lib/pinned-tabs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppLauncher } from './app-launcher';
import { Icon } from './icons';
import { OrgSwitcher } from './org-switcher';
import { Kbd } from './primitives';
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
          return (
            <div key={tab.href} className="shelltab-cell" data-active={active ? 'true' : undefined}>
              <Link href={tab.href} className="shelltab">
                <Icon name={tab.icon} size={15} />
                <span>{tab.label}</span>
              </Link>
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
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          );
        })}
      </nav>
      <button type="button" className="shellbar__search" onClick={onOpenSearch}>
        <Icon name="magnifying-glass" size={15} />
        <span>Search…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <div className="shellbar__actions">
        <IconButton icon="question" label="Help" />
        <IconButton icon="bell" label="Notifications" />
        <UserMenu name={userName} email={userEmail} compact />
      </div>
    </header>
  );
}
