// ViewIcon → Lucide component map. The view row stores a short string key
// (`pin`, `building`, `dollar`); this is where the actual icon component
// lives. Adding a new icon = add to ViewIcon in @northbeam/db/views + one
// line here.

import type { ViewIcon } from '@northbeam/db/views';
import {
  Bookmark,
  Briefcase,
  Building2,
  CalendarDays,
  ChartBar,
  Clock,
  DollarSign,
  Eye,
  Flag,
  Folder,
  Heart,
  Inbox,
  List,
  Pin,
  Star,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const VIEW_ICONS: Record<ViewIcon, LucideIcon> = {
  list: List,
  pin: Pin,
  star: Star,
  bookmark: Bookmark,
  inbox: Inbox,
  folder: Folder,
  briefcase: Briefcase,
  flag: Flag,
  eye: Eye,
  heart: Heart,
  building: Building2,
  users: Users,
  dollar: DollarSign,
  chart: ChartBar,
  calendar: CalendarDays,
  clock: Clock,
};

/** Order for the picker — visually grouped: generic first, then themed. */
export const VIEW_ICON_ORDER: ViewIcon[] = [
  'list',
  'pin',
  'star',
  'bookmark',
  'inbox',
  'folder',
  'briefcase',
  'flag',
  'eye',
  'heart',
  'building',
  'users',
  'dollar',
  'chart',
  'calendar',
  'clock',
];

export function getViewIcon(key: string | null | undefined): LucideIcon {
  const k = (key ?? 'list') as ViewIcon;
  return VIEW_ICONS[k] ?? List;
}
