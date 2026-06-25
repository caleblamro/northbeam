// Renderer registry. List is the only built-in view today; AI generation
// lives behind the ⌘K palette and never registers as a view type.

import { DashboardRenderer } from '@/components/northbeam/views/dashboard-renderer';
import { ListRenderer } from '@/components/northbeam/views/list-renderer';
import type { ViewRenderer, ViewType } from '@/lib/views/types';

export const VIEW_RENDERERS = {
  list: ListRenderer,
  dashboard: DashboardRenderer,
} satisfies Partial<Record<ViewType, ViewRenderer>>;

export function getViewRenderer(type: ViewType): ViewRenderer | null {
  return (VIEW_RENDERERS as Partial<Record<ViewType, ViewRenderer>>)[type] ?? null;
}

/** Types that have a registered renderer. Drives the (currently single-item)
 *  type switcher and any UI that needs the full set of pickable view types. */
export function availableViewTypes(): ViewType[] {
  return Object.keys(VIEW_RENDERERS) as ViewType[];
}
