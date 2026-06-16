// Renderer registry. New view types ship by registering here — RecordListView
// dispatches purely off this map. Phase 0 seeds only `list`; Kanban / Calendar
// / AI register as follow-up tasks (#26, #11).

import { AIRenderer } from '@/components/northbeam/views/ai-renderer';
import { CalendarRenderer } from '@/components/northbeam/views/calendar-renderer';
import { GridRenderer } from '@/components/northbeam/views/grid-renderer';
import { KanbanRenderer } from '@/components/northbeam/views/kanban-renderer';
import { ListRenderer } from '@/components/northbeam/views/list-renderer';
import type { ViewRenderer, ViewType } from '@/lib/views/types';

export const VIEW_RENDERERS = {
  list: ListRenderer,
  grid: GridRenderer,
  kanban: KanbanRenderer,
  calendar: CalendarRenderer,
  ai: AIRenderer,
} satisfies Partial<Record<ViewType, ViewRenderer>>;

export function getViewRenderer(type: ViewType): ViewRenderer | null {
  return (VIEW_RENDERERS as Partial<Record<ViewType, ViewRenderer>>)[type] ?? null;
}

/** Types that have a registered renderer — drives the type-picker dropdown
 *  on the view editor. */
export function availableViewTypes(): ViewType[] {
  return Object.keys(VIEW_RENDERERS) as ViewType[];
}
