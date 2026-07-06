// Node vocabulary for the flow builder — one entry per FlowNodeType with the
// label/icon/tone/category/summary shared by the canvas nodes, the add-node
// menu, the automations list page, and run history. Pure module (no React):
// safe to import from server components and unit tests.

import type {
  FlowNode,
  FlowNodeOfType,
  FlowNodeType,
  FlowRecordTarget,
  FlowSchedule,
  FlowUpdateTarget,
} from '@northbeam/core/flow';
import {
  Bell,
  Bot,
  CalendarClock,
  CirclePlus,
  Equal,
  Globe,
  Hourglass,
  type LucideIcon,
  Mail,
  MessageSquareText,
  Repeat,
  Search,
  Sparkles,
  Split,
  SquarePen,
  Trash2,
  UserRoundCheck,
  Webhook,
  Zap,
} from 'lucide-react';

export type FlowNodeCategory = 'trigger' | 'logic' | 'action';

/** Subset of IconTile tones the canvas uses — the system stays monochrome
 *  except the single accent (triggers + AI) and danger (delete). */
export type FlowNodeTone = 'neutral' | 'accent' | 'danger';

/** Optional metadata lookups that upgrade summaries from raw keys to labels.
 *  Callers without org metadata (tests, list rows) pass nothing. */
export type NodeSummaryContext = {
  fieldLabel?: (fieldKey: string) => string;
  objectLabel?: (objectKey: string) => string;
};

export type FlowNodeCatalogEntry<T extends FlowNodeType = FlowNodeType> = {
  type: T;
  label: string;
  icon: LucideIcon;
  tone: FlowNodeTone;
  category: FlowNodeCategory;
  /** Blurb for the add-node menu. */
  hint: string;
  /** One-line config summary rendered under the node title. */
  summary: (node: FlowNodeOfType<T>, ctx?: NodeSummaryContext) => string;
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function field(key: string, ctx?: NodeSummaryContext): string {
  return ctx?.fieldLabel?.(key) ?? key;
}

function object(key: string, ctx?: NodeSummaryContext): string {
  return key ? (ctx?.objectLabel?.(key) ?? key) : '…';
}

function describeSchedule(schedule: FlowSchedule): string {
  switch (schedule.frequency) {
    case 'once':
      return `Once at ${schedule.at}`;
    case 'daily':
      return `Daily at ${schedule.time}`;
    case 'weekly':
      return `Weekly on ${WEEKDAYS[schedule.weekday] ?? `day ${schedule.weekday}`} at ${schedule.time}`;
    case 'cron':
      return `Cron ${schedule.expression}`;
  }
}

function describeTarget(target: FlowRecordTarget | FlowUpdateTarget, ctx?: NodeSummaryContext) {
  switch (target.kind) {
    case 'trigger_record':
      return 'the trigger record';
    case 'loop_item':
      return 'the loop item';
    case 'var':
      return `{{vars.${target.name}}}`;
    case 'query':
      return `up to ${target.limit} ${object(target.objectKey, ctx)}`;
  }
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Complete per-type registry. Indexed access stays type-safe via catalogFor. */
export const NODE_CATALOG: { [T in FlowNodeType]: FlowNodeCatalogEntry<T> } = {
  trigger_record: {
    type: 'trigger_record',
    label: 'Record trigger',
    icon: Zap,
    tone: 'accent',
    category: 'trigger',
    hint: 'Runs when a record is created, updated, or deleted',
    summary: (node) => {
      const EVENTS = {
        created: 'created',
        updated: 'updated',
        created_or_updated: 'created or updated',
        deleted: 'deleted',
      } as const;
      const watched = node.config.watchedFieldKeys?.length;
      const suffix = watched ? ` · watching ${count(watched, 'field')}` : '';
      return `When a record is ${EVENTS[node.config.event]}${suffix}`;
    },
  },
  trigger_scheduled: {
    type: 'trigger_scheduled',
    label: 'Schedule trigger',
    icon: CalendarClock,
    tone: 'accent',
    category: 'trigger',
    hint: 'Runs on a schedule',
    summary: (node) => `${describeSchedule(node.config.schedule)} (${node.config.timezone})`,
  },
  trigger_webhook: {
    type: 'trigger_webhook',
    label: 'Webhook trigger',
    icon: Webhook,
    tone: 'accent',
    category: 'trigger',
    hint: 'Runs when the flow’s webhook URL receives a request',
    summary: () => 'When the webhook receives a request',
  },
  decision: {
    type: 'decision',
    label: 'Decision',
    icon: Split,
    tone: 'neutral',
    category: 'logic',
    hint: 'Branch on conditions — the first matching outcome wins',
    summary: (node) => {
      const labels = node.config.outcomes.map((o) => o.label).join(' / ');
      return `${count(node.config.outcomes.length, 'outcome')} · ${labels}`;
    },
  },
  assignment: {
    type: 'assignment',
    label: 'Assignment',
    icon: Equal,
    tone: 'neutral',
    category: 'logic',
    hint: 'Set flow variables or in-memory record fields',
    summary: (node, ctx) => {
      const targets = node.config.assignments.map((a) =>
        a.target.scope === 'vars' ? `{{vars.${a.target.name}}}` : field(a.target.fieldKey, ctx),
      );
      return `Set ${targets.join(', ')}`;
    },
  },
  get_records: {
    type: 'get_records',
    label: 'Get records',
    icon: Search,
    tone: 'neutral',
    category: 'logic',
    hint: 'Query records into a flow variable',
    summary: (node, ctx) =>
      `Up to ${node.config.limit} ${object(node.config.objectKey, ctx)} → {{vars.${node.config.assignTo}}}`,
  },
  loop: {
    type: 'loop',
    label: 'Loop',
    icon: Repeat,
    tone: 'neutral',
    category: 'logic',
    hint: 'Repeat steps for each item in a collection',
    summary: (node) => `For each item in {{vars.${node.config.sourceVar}}}`,
  },
  wait: {
    type: 'wait',
    label: 'Wait',
    icon: Hourglass,
    tone: 'neutral',
    category: 'logic',
    hint: 'Pause the run for a duration or until a moment',
    summary: (node, ctx) => {
      const config = node.config;
      switch (config.kind) {
        case 'duration':
          return `Wait ${config.amount} ${config.unit}`;
        case 'until':
          return `Wait until ${config.at}`;
        case 'relative_to_field': {
          const magnitude = Math.abs(config.offset);
          const when = config.offset < 0 ? 'before' : 'after';
          return `Wait ${magnitude} ${config.unit} ${when} ${field(config.fieldKey, ctx)}`;
        }
      }
    },
  },
  update_records: {
    type: 'update_records',
    label: 'Update records',
    icon: SquarePen,
    tone: 'neutral',
    category: 'action',
    hint: 'Write field values onto records',
    summary: (node, ctx) => {
      const n = Object.keys(node.config.fields).length;
      return `Update ${describeTarget(node.config.target, ctx)} · ${count(n, 'field')}`;
    },
  },
  create_record: {
    type: 'create_record',
    label: 'Create record',
    icon: CirclePlus,
    tone: 'neutral',
    category: 'action',
    hint: 'Create a new record',
    summary: (node, ctx) => {
      const n = Object.keys(node.config.fields).length;
      const into = node.config.assignTo ? ` → {{vars.${node.config.assignTo}}}` : '';
      return `Create ${object(node.config.objectKey, ctx)} · ${count(n, 'field')}${into}`;
    },
  },
  delete_record: {
    type: 'delete_record',
    label: 'Delete record',
    icon: Trash2,
    tone: 'danger',
    category: 'action',
    hint: 'Delete a record',
    summary: (node, ctx) => `Delete ${describeTarget(node.config.target, ctx)}`,
  },
  assign_owner: {
    type: 'assign_owner',
    label: 'Assign owner',
    icon: UserRoundCheck,
    tone: 'neutral',
    category: 'action',
    hint: 'Change a record’s owner',
    summary: (node, ctx) => {
      const owner =
        node.config.owner.kind === 'user' ? 'a member' : `{{${node.config.owner.value}}}`;
      return `Assign ${describeTarget(node.config.target, ctx)} to ${owner}`;
    },
  },
  send_email: {
    type: 'send_email',
    label: 'Send email',
    icon: Mail,
    tone: 'neutral',
    category: 'action',
    hint: 'Send an email',
    summary: (node) => {
      const [first] = node.config.to;
      const more = node.config.to.length > 1 ? ` +${node.config.to.length - 1}` : '';
      return `To ${first ?? '…'}${more} — ${node.config.subject || '…'}`;
    },
  },
  post_timeline: {
    type: 'post_timeline',
    label: 'Post to timeline',
    icon: MessageSquareText,
    tone: 'neutral',
    category: 'action',
    hint: 'Add a system note to a record’s activity timeline',
    summary: (node, ctx) => `Note on ${describeTarget(node.config.target, ctx)}`,
  },
  notify: {
    type: 'notify',
    label: 'Notify',
    icon: Bell,
    tone: 'neutral',
    category: 'action',
    hint: 'Send an in-app notification',
    summary: (node) =>
      `“${node.config.title || '…'}” → ${count(node.config.recipients.length, 'recipient')}`,
  },
  webhook_out: {
    type: 'webhook_out',
    label: 'Send webhook',
    icon: Globe,
    tone: 'neutral',
    category: 'action',
    hint: 'Call an external HTTPS endpoint',
    summary: (node) => `${node.config.method} ${node.config.url || '…'}`,
  },
  ai_step: {
    type: 'ai_step',
    label: 'AI step',
    icon: Sparkles,
    tone: 'accent',
    category: 'action',
    hint: 'Classify, extract, or draft with Claude',
    summary: (node, ctx) => {
      const MODES = { classify: 'Classify', extract: 'Extract', draft: 'Draft' } as const;
      const output =
        node.config.output.scope === 'vars'
          ? `{{vars.${node.config.output.name}}}`
          : field(node.config.output.fieldKey, ctx);
      return `${MODES[node.config.mode]} → ${output}`;
    },
  },
  agent_step: {
    type: 'agent_step',
    label: 'Pass to agent',
    icon: Bot,
    tone: 'accent',
    category: 'action',
    hint: 'Hand the record to an AI agent with tools',
    summary: (node) => {
      const writes = node.config.toolIds.some(
        (t) =>
          t !== 'search_records' &&
          t !== 'get_record' &&
          t !== 'aggregate_records' &&
          t !== 'inspect_metadata',
      );
      return `${node.config.agentKey ?? 'Base agent'} · ${count(node.config.toolIds.length, 'tool')}${writes ? ' (can write)' : ''}`;
    },
  },
};

/** Typed registry access — narrows the entry to the node's type. */
export function catalogFor<T extends FlowNodeType>(type: T): FlowNodeCatalogEntry<T> {
  return NODE_CATALOG[type];
}

/** Display title: explicit name first, catalog label as the fallback. */
export function nodeTitle(node: FlowNode): string {
  return node.name ?? NODE_CATALOG[node.type].label;
}

/** One-line config summary for any node. */
export function nodeSummary(node: FlowNode, ctx?: NodeSummaryContext): string {
  // The union collapses per-type at the registry boundary; catalogFor keeps
  // the entry↔node pairing type-safe for external callers.
  const entry = NODE_CATALOG[node.type] as FlowNodeCatalogEntry;
  return entry.summary(node as never, ctx);
}

/** Add-node menu groups — triggers are excluded (one per flow, created with
 *  the flow itself, never inserted mid-graph). */
export const CATALOG_GROUPS: ReadonlyArray<{
  label: string;
  category: FlowNodeCategory;
  types: readonly FlowNodeType[];
}> = [
  {
    label: 'Logic',
    category: 'logic',
    types: ['decision', 'assignment', 'get_records', 'loop', 'wait'],
  },
  {
    label: 'Actions',
    category: 'action',
    types: [
      'update_records',
      'create_record',
      'delete_record',
      'assign_owner',
      'send_email',
      'post_timeline',
      'notify',
      'webhook_out',
      'ai_step',
      'agent_step',
    ],
  },
];

/** Minimal starting config per type. Placeholders ('' keys, empty targets)
 *  are intentionally incomplete — the config panel fills them in and the
 *  server's automation.validate gates activation; only the graph SHAPE must
 *  hold here (validateFlowGraph never inspects config strings). */
export function createDefaultNode(type: FlowNodeType, id: string): FlowNode {
  switch (type) {
    case 'trigger_record':
      return { id, type, config: { event: 'created_or_updated' } };
    case 'trigger_scheduled':
      return {
        id,
        type,
        config: { schedule: { frequency: 'daily', time: '09:00' }, timezone: 'UTC' },
      };
    case 'trigger_webhook':
      return { id, type, config: {} };
    case 'decision':
      return {
        id,
        type,
        config: {
          outcomes: [
            {
              id: 'outcome_1',
              label: 'Outcome 1',
              condition: {
                mode: 'filters',
                logic: 'and',
                filters: [{ fieldKey: '', op: 'isSet' }],
              },
            },
          ],
        },
      };
    case 'assignment':
      return {
        id,
        type,
        config: { assignments: [{ target: { scope: 'vars', name: 'value' }, value: '' }] },
      };
    case 'get_records':
      return { id, type, config: { objectKey: '', limit: 50, assignTo: 'records' } };
    case 'loop':
      return { id, type, config: { sourceVar: 'records' } };
    case 'wait':
      return { id, type, config: { kind: 'duration', amount: 1, unit: 'days' } };
    case 'update_records':
      return { id, type, config: { target: { kind: 'trigger_record' }, fields: {} } };
    case 'create_record':
      return { id, type, config: { objectKey: '', fields: {} } };
    case 'delete_record':
      return { id, type, config: { target: { kind: 'trigger_record' } } };
    case 'assign_owner':
      return {
        id,
        type,
        config: { target: { kind: 'trigger_record' }, owner: { kind: 'user', userId: '' } },
      };
    case 'send_email':
      return { id, type, config: { to: [], subject: '', body: '' } };
    case 'post_timeline':
      return { id, type, config: { target: { kind: 'trigger_record' }, body: '' } };
    case 'notify':
      return { id, type, config: { recipients: [{ kind: 'record_owner' }], title: '', body: '' } };
    case 'webhook_out':
      return { id, type, config: { url: '', method: 'POST' } };
    case 'ai_step':
      return {
        id,
        type,
        config: {
          mode: 'classify',
          prompt: '',
          options: [],
          output: { scope: 'vars', name: 'result' },
        },
      };
    case 'agent_step':
      return {
        id,
        type,
        config: {
          mission: '',
          // Read-only by default — enabling writes is the author's call.
          toolIds: ['search_records', 'get_record', 'aggregate_records', 'inspect_metadata'],
          maxToolCalls: 5,
          output: { scope: 'vars', name: 'agent_report' },
        },
      };
  }
}
