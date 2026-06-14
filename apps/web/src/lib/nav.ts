// App-wide navigation model. Two consumers:
//   - The App Launcher (9-dot waffle) shows LAUNCHER_TILES grouped by section.
//   - The ⌘K command palette uses NAV_FLAT to jump anywhere.
// PAGE_META drives the in-app page header (title + subtitle + icon).
// Icons resolve through components/northbeam/icons.tsx (Phosphor → lucide map).

import type { IconName } from '@/components/northbeam/icons';

export type NavItem = {
  label: string;
  href: string;
  icon: IconName;
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

// Grouped tiles for the App Launcher popover. Salesforce groups Sales/Service/
// Setup; we group Workspace/Insights/Setup so the muscle memory carries over.
export const LAUNCHER_TILES: NavSection[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Home', href: '/', icon: 'house', match: (p) => p === '/' },
      { label: 'Accounts', href: '/accounts', icon: 'buildings' },
      { label: 'Contacts', href: '/contacts', icon: 'users-three' },
      { label: 'Deals', href: '/deals', icon: 'currency-circle-dollar' },
      { label: 'Activities', href: '/activities', icon: 'lightning' },
      { label: 'Tasks', href: '/tasks', icon: 'check-circle' },
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
      { label: 'Setup', href: '/setup', icon: 'gear-six', match: starts('/setup', '/settings') },
    ],
  },
];

export const NAV_FLAT: Array<NavItem & { section: string }> = LAUNCHER_TILES.flatMap((s) =>
  s.items.map((it) => ({ ...it, section: s.label })),
);

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

// Page chrome the (app) layout renders — so individual pages don't re-declare
// a header. Keyed by route; icon falls back to the matching nav item.
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
  '/settings': { title: 'Setup', subtitle: 'Manage your workspace, team, and billing.' },
  '/setup': { title: 'Setup', subtitle: 'Manage your workspace, team, and billing.' },
  '/setup/workspace': { title: 'Setup', subtitle: 'Workspace identity and defaults.' },
  '/setup/billing': { title: 'Setup', subtitle: 'Plan, payment methods, and invoices.' },
  '/setup/users': { title: 'Setup', subtitle: 'Members, invitations, and roles.' },
  '/setup/permissions': {
    title: 'Setup',
    subtitle: 'What each role can do across the workspace.',
  },
  '/setup/objects': {
    title: 'Setup',
    subtitle: 'Manage objects, fields, and layouts.',
  },
  '/setup/integrations': {
    title: 'Setup',
    subtitle: 'Connect Salesforce and other external systems.',
  },
  '/setup/audit': {
    title: 'Setup',
    subtitle: 'Every action across the workspace, who did it, and when.',
  },
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
  const navItem =
    NAV_FLAT.find((n) => n.href === pathname) ?? NAV_FLAT.find((n) => isNavActive(n, pathname));
  return { ...meta, icon: meta.icon ?? navItem?.icon };
}
