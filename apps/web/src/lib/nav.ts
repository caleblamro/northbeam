// Sidebar / command-palette navigation model. Icons are Phosphor names
// resolved through components/northbeam/icons.tsx (Icon).

import type { IconName } from '@/components/northbeam/icons';

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
  count?: string;
  badge?: string;
  accent?: boolean;
  match?: (path: string) => boolean;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

const starts =
  (...prefixes: string[]) =>
  (p: string) =>
    prefixes.some((pre) => p === pre || p.startsWith(`${pre}/`));

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Home', href: '/', icon: 'house', match: (p) => p === '/' },
      { label: 'Contacts', href: '/contacts', icon: 'users-three', count: '2.4k' },
      { label: 'Accounts', href: '/accounts', icon: 'buildings', count: '318' },
      { label: 'Deals', href: '/deals', icon: 'currency-circle-dollar', count: '47' },
      { label: 'Activities', href: '/activities', icon: 'lightning' },
      { label: 'Tasks', href: '/tasks', icon: 'check-circle', badge: '5' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Pipeline', href: '/pipeline', icon: 'funnel' },
      { label: 'Reports', href: '/reports', icon: 'chart-line-up' },
      { label: 'Dashboards', href: '/dashboards', icon: 'squares-four' },
    ],
  },
  {
    label: 'Setup',
    items: [
      {
        label: 'Migrate from Salesforce',
        href: '/migrate',
        icon: 'arrows-clockwise',
        accent: true,
      },
      { label: 'Settings', href: '/settings', icon: 'gear-six', match: starts('/settings') },
    ],
  },
];

export const NAV_FLAT: Array<NavItem & { section: string }> = NAV_SECTIONS.flatMap((s) =>
  s.items.map((it) => ({ ...it, section: s.label })),
);

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

// Page chrome (icon + title + subtitle) the (app) layout renders — so individual
// pages don't re-declare a header. Keyed by route; icon comes from the nav.
export type PageMeta = { title: string; subtitle?: string; icon?: IconName };

export const PAGE_META: Record<string, PageMeta> = {
  '/': { title: 'Home', subtitle: "Here's what's moving across your workspace today." },
  '/contacts': {
    title: 'Contacts',
    subtitle: 'Everyone across your accounts — synced from Salesforce on every migration.',
  },
  '/accounts': {
    title: 'Accounts',
    subtitle: 'Companies in your pipeline, with plan, ARR, and account health.',
  },
  '/deals': { title: 'Deals', subtitle: 'Track opportunities through your pipeline.' },
  '/activities': {
    title: 'Activities',
    subtitle: 'Calls, emails, notes, and stage changes across your records.',
  },
  '/tasks': {
    title: 'Tasks',
    subtitle: 'Your follow-ups across deals, contacts, and the migration.',
  },
  '/pipeline': { title: 'Pipeline', subtitle: 'Your deal funnel, stage by stage.' },
  '/reports': {
    title: 'Reports',
    subtitle: 'Ask in plain language. Northbeam builds the report and surfaces what changed.',
  },
  '/dashboards': { title: 'Dashboards', subtitle: 'Pin the metrics your team watches.' },
  '/migrate': {
    title: 'Migrate from Salesforce',
    subtitle: "One-click import — Northbeam's AI maps your objects and fields.",
  },
  '/settings': { title: 'Settings', subtitle: 'Manage your workspace, team, and billing.' },
};

export function pageMetaFor(pathname: string): PageMeta {
  const exact = PAGE_META[pathname];
  const meta =
    exact ??
    (() => {
      const key = Object.keys(PAGE_META)
        .filter((k) => k !== '/' && pathname.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
      return (key ? PAGE_META[key] : undefined) ?? { title: 'Northbeam' };
    })();
  // Icon comes from the matching nav item (single source of truth).
  const navItem =
    NAV_FLAT.find((n) => n.href === pathname) ?? NAV_FLAT.find((n) => isNavActive(n, pathname));
  return { ...meta, icon: meta.icon ?? navItem?.icon };
}
