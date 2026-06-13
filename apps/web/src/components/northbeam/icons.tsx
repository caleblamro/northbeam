// Icon barrel. The handoff used Phosphor glyph names (e.g. "users-three");
// brink uses lucide-react. Following brink, we centralize a Phosphor→lucide map
// here so call sites can keep the handoff's string names and the icon-set swap
// lives in exactly one place.

import {
  AlertCircle,
  Archive,
  ArrowRight,
  Bell,
  Bold,
  BookOpen,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  CircleChevronDown,
  CircleDollarSign,
  Command,
  Copy,
  CornerDownLeft,
  CreditCard,
  ExternalLink,
  Eye,
  Filter,
  Github,
  HelpCircle,
  Home,
  Info,
  Italic,
  Keyboard,
  Layers,
  Layout,
  LayoutGrid,
  Lightbulb,
  Link as LinkIcon,
  List,
  ListPlus,
  Loader2,
  type LucideIcon,
  Mail,
  Moon,
  MoreHorizontal,
  MoreVertical,
  MousePointerClick,
  Network,
  Palette,
  PanelLeft,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Ruler,
  Search,
  Send,
  Settings,
  SquarePen,
  Star,
  Sun,
  TextCursorInput,
  Trash2,
  TrendingUp,
  Type,
  Upload,
  User,
  UserPlus,
  Users,
  X,
  XCircle,
  Zap,
} from 'lucide-react';

// Phosphor name (as used across design_handoff_northbeam/*) → lucide component.
const MAP: Record<string, LucideIcon> = {
  house: Home,
  'users-three': Users,
  buildings: Building2,
  'currency-circle-dollar': CircleDollarSign,
  lightning: Zap,
  'chart-line-up': TrendingUp,
  funnel: Filter,
  'gear-six': Settings,
  'magnifying-glass': Search,
  'caret-up-down': ChevronsUpDown,
  'caret-down': ChevronDown,
  'caret-right': ChevronRight,
  'caret-up': ChevronUp,
  'dots-three': MoreHorizontal,
  'dots-three-vertical': MoreVertical,
  check: Check,
  'check-circle': CheckCircle2,
  plus: Plus,
  'arrows-clockwise': RefreshCw,
  trash: Trash2,
  'arrow-right': ArrowRight,
  'pencil-simple': Pencil,
  copy: Copy,
  'arrow-square-out': ExternalLink,
  archive: Archive,
  'paper-plane-tilt': Send,
  star: Star,
  'text-b': Bold,
  'text-italic': Italic,
  'link-simple': LinkIcon,
  'list-bullets': List,
  paperclip: Paperclip,
  'user-plus': UserPlus,
  command: Command,
  'envelope-simple': Mail,
  phone: Phone,
  'credit-card': CreditCard,
  'calendar-blank': Calendar,
  x: X,
  'x-circle': XCircle,
  eye: Eye,
  'warning-circle': AlertCircle,
  'spinner-gap': Loader2,
  user: User,
  'note-pencil': SquarePen,
  'upload-simple': Upload,
  'arrow-elbow-down-left': CornerDownLeft,
  keyboard: Keyboard,
  lightbulb: Lightbulb,
  info: Info,
  'book-open': BookOpen,
  palette: Palette,
  'text-aa': Type,
  ruler: Ruler,
  'cursor-click': MousePointerClick,
  'squares-four': LayoutGrid,
  'list-plus': ListPlus,
  textbox: TextCursorInput,
  'caret-circle-down': CircleChevronDown,
  'sidebar-simple': PanelLeft,
  sun: Sun,
  moon: Moon,
  'github-logo': Github,
  bell: Bell,
  question: HelpCircle,
  stack: Layers,
  'tree-structure': Network,
  layout: Layout,
  pin: Pin,
  'pin-off': PinOff,
};

export type IconName = keyof typeof MAP | (string & {});

/** Render a handoff glyph by its Phosphor name. `fill` mimics Phosphor's fill
 *  weight (only meaningful for outline-able glyphs like star). */
export function Icon({
  name,
  size = 16,
  className,
  fill,
  strokeWidth,
}: {
  name: IconName;
  size?: number;
  className?: string;
  fill?: boolean;
  strokeWidth?: number;
}) {
  const Cmp = MAP[name] ?? Search;
  return (
    <Cmp
      size={size}
      className={className}
      strokeWidth={strokeWidth ?? 2}
      fill={fill ? 'currentColor' : 'none'}
      aria-hidden="true"
    />
  );
}

export { MAP as ICON_MAP };
