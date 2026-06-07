// Command-palette item set — ported from design_handoff_northbeam/lib-command.jsx.
import type { IconName } from '@/components/northbeam/icons';

export type CmdItem = {
  id: string;
  group: string;
  icon?: IconName;
  avatar?: boolean;
  label: string;
  sub?: string;
  meta?: string;
  kbd?: string;
  href?: string;
};

export const CMD_GROUP_ORDER = ['Quick actions', 'Go to', 'Records'] as const;

export const CMD_ITEMS: CmdItem[] = [
  {
    id: 'a1',
    group: 'Quick actions',
    icon: 'user-plus',
    label: 'Create contact',
    sub: 'Add a new person',
    kbd: 'C then P',
  },
  {
    id: 'a2',
    group: 'Quick actions',
    icon: 'currency-circle-dollar',
    label: 'Create deal',
    sub: 'Open a new opportunity',
    kbd: 'C then D',
  },
  {
    id: 'a3',
    group: 'Quick actions',
    icon: 'arrows-clockwise',
    label: 'Run Salesforce migration',
    sub: 'Sync historical records',
  },
  { id: 'a4', group: 'Quick actions', icon: 'upload-simple', label: 'Import from CSV' },
  { id: 'a5', group: 'Quick actions', icon: 'note-pencil', label: 'Log an activity' },
  { id: 'n1', group: 'Go to', icon: 'users-three', label: 'Contacts', href: '/contacts' },
  { id: 'n2', group: 'Go to', icon: 'buildings', label: 'Accounts', href: '/accounts' },
  { id: 'n3', group: 'Go to', icon: 'currency-circle-dollar', label: 'Deals', href: '/deals' },
  { id: 'n4', group: 'Go to', icon: 'chart-line-up', label: 'Reports', href: '/reports' },
  { id: 'n5', group: 'Go to', icon: 'gear-six', label: 'Settings', href: '/settings' },
  {
    id: 'r1',
    group: 'Records',
    avatar: true,
    label: 'Marcus Chen',
    sub: 'VP Sales · Vertex Industries',
    meta: 'Contact',
  },
  {
    id: 'r2',
    group: 'Records',
    avatar: true,
    label: 'Priya Anand',
    sub: 'CTO · Lumen Labs',
    meta: 'Contact',
  },
  {
    id: 'r3',
    group: 'Records',
    icon: 'buildings',
    label: 'Vertex Industries',
    sub: 'Enterprise · $2.4M ARR',
    meta: 'Account',
  },
  {
    id: 'r4',
    group: 'Records',
    icon: 'buildings',
    label: 'Lumen Labs',
    sub: 'Mid-market · $480K ARR',
    meta: 'Account',
  },
];
