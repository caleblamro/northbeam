// Flow contract — the node/edge graph behind automation flows. One schema,
// three consumers (pattern: artifact.ts — pure zod, browser-safe, no db/pino):
//   - apps/web .../automation/* renders + edits the graph on the canvas and
//     mirrors validateFlowGraph() on every change
//   - apps/api src/automation/* executes the ACTIVE version and re-validates
//     on activate (server is the source of truth)
//   - apps/api src/salesforce/flow-mapper.ts emits this shape from SF Flow /
//     Workflow Rule metadata (FlowGraphSchema.safeParse is its own-bug guard)
//
// Deliberately NOT here: node positions (the canvas derives layout with dagre
// — the graph stays pure semantics), metadata validation (fields exist,
// formulas parse — that needs the org's metadata and lives in the api's
// `automation.validate`), and evaluation of any kind.

import { z } from 'zod';

/** Engine + graph budgets. The schema enforces maxNodes/maxEdges; the walker
 *  enforces maxSteps/maxLoopIterations/maxLoopNesting; the dispatcher enforces
 *  maxDepth (flow-triggers-flow recursion); executors enforce maxGetRecords;
 *  the scheduler enforces maxScheduledFanout. */
export const FLOW_LIMITS = {
  maxNodes: 100,
  maxEdges: 200,
  maxSteps: 500,
  maxLoopIterations: 200,
  maxLoopNesting: 2,
  maxDepth: 5,
  maxGetRecords: 200,
  maxScheduledFanout: 1000,
} as const;

/* ── Conditions ─────────────────────────────────────────────────────────── */

/** Mirrors @northbeam/db's FilterOp verbatim — core stays db-free (browser
 *  bundles), so the list is duplicated and sync-pinned by a compile-time test
 *  (apps/api/tests/automation/flow-schemas.test.ts). */
export const FLOW_FILTER_OPS = [
  'eq',
  'neq',
  'contains',
  'startsWith',
  'endsWith',
  'gt',
  'lt',
  'gte',
  'lte',
  'before',
  'after',
  'isTrue',
  'isFalse',
  'isEmpty',
  'isSet',
] as const;

export type FlowFilterOp = (typeof FLOW_FILTER_OPS)[number];

export const FlowFilterSchema = z.object({
  fieldKey: z.string().min(1),
  op: z.enum(FLOW_FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export type FlowFilter = z.infer<typeof FlowFilterSchema>;

/** Entry conditions + decision outcomes: either a flat filter list (the
 *  FilterRow editor UI) or a formula string (the formula engine evaluates it
 *  server-side — never here). */
export const FlowConditionSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('filters'),
    logic: z.enum(['and', 'or']),
    filters: z.array(FlowFilterSchema).min(1).max(10),
  }),
  z.object({
    mode: z.literal('formula'),
    formula: z.string().min(1).max(2000),
  }),
]);

export type FlowCondition = z.infer<typeof FlowConditionSchema>;

/* ── Shared fragments ───────────────────────────────────────────────────── */

const NodeIdSchema = z.string().min(1).max(64);

/** Flow variable names — set by assignment/get_records/create_record/ai_step,
 *  read via the `{{vars.<name>}}` template scope. */
const VarNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'lowercase variable name');

/** A literal or `{{merge}}` template value written into a record field or
 *  variable. Strings interpolate through flow-template.ts at run time. */
const FlowValueSchema = z.union([z.string().max(4000), z.number(), z.boolean(), z.null()]);

/** fieldKey → value map for create/update nodes. */
const FieldValuesSchema = z
  .record(z.string().min(1), FlowValueSchema)
  .refine((fields) => Object.keys(fields).length >= 1, 'at least one field')
  .refine((fields) => Object.keys(fields).length <= 50, 'at most 50 fields');

/** Where an in-flow write lands: a flow variable, or an in-memory field of
 *  the trigger record (SF assignment semantics — persisting the field still
 *  requires an update_records node). */
export const FlowAssignTargetSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('vars'), name: VarNameSchema }),
  z.object({ scope: z.literal('record'), fieldKey: z.string().min(1) }),
]);

export type FlowAssignTarget = z.infer<typeof FlowAssignTargetSchema>;

const RecordTargetOptions = [
  z.object({ kind: z.literal('trigger_record') }),
  z.object({ kind: z.literal('loop_item') }),
  z.object({ kind: z.literal('var'), name: VarNameSchema }),
] as const;

/** Which record(s) an action node operates on. */
export const FlowRecordTargetSchema = z.discriminatedUnion('kind', [...RecordTargetOptions]);

export type FlowRecordTarget = z.infer<typeof FlowRecordTargetSchema>;

/** update_records additionally allows a bounded inline query. */
export const FlowUpdateTargetSchema = z.discriminatedUnion('kind', [
  ...RecordTargetOptions,
  z.object({
    kind: z.literal('query'),
    objectKey: z.string().min(1),
    filters: z.array(FlowFilterSchema).min(1).max(10),
    logic: z.enum(['and', 'or']),
    limit: z.number().int().min(1).max(FLOW_LIMITS.maxGetRecords),
  }),
]);

export type FlowUpdateTarget = z.infer<typeof FlowUpdateTargetSchema>;

/** Template-bearing strings resolved by flow-template.ts at run time. */
const TemplateStringSchema = z.string().min(1).max(4000);

const nodeBase = {
  id: NodeIdSchema,
  /** Display label only — positions/layout never persist. */
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
};

/* ── Triggers ───────────────────────────────────────────────────────────── */

const TriggerRecordNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('trigger_record'),
  config: z.object({
    event: z.enum(['created', 'updated', 'created_or_updated', 'deleted']),
    /** Fire only when one of these fields changed (update events). Absent or
     *  empty = any change. The object itself lives on the flow row. */
    watchedFieldKeys: z.array(z.string().min(1)).max(20).optional(),
    entryCondition: FlowConditionSchema.optional(),
  }),
});

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const FlowScheduleSchema = z.discriminatedUnion('frequency', [
  z.object({ frequency: z.literal('once'), at: z.iso.datetime({ offset: true }) }),
  z.object({ frequency: z.literal('daily'), time: z.string().regex(HHMM_RE, 'HH:mm') }),
  z.object({
    frequency: z.literal('weekly'),
    /** 0 = Sunday … 6 = Saturday. */
    weekday: z.number().int().min(0).max(6),
    time: z.string().regex(HHMM_RE, 'HH:mm'),
  }),
  z.object({
    frequency: z.literal('cron'),
    expression: z
      .string()
      .max(120)
      .regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, 'five-field cron expression'),
  }),
]);

export type FlowSchedule = z.infer<typeof FlowScheduleSchema>;

const TriggerScheduledNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('trigger_scheduled'),
  config: z.object({
    schedule: FlowScheduleSchema,
    /** IANA zone name; existence is checked in `automation.validate`. */
    timezone: z.string().min(1).max(64),
    /** Object-scoped flows fire one run per matching record. */
    entryCondition: FlowConditionSchema.optional(),
  }),
});

const TriggerWebhookNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('trigger_webhook'),
  /** The signing secret lives on the flow row, not in the graph. */
  config: z.object({}),
});

/** Standalone trigger union for the denormalized `flow.draftTrigger` column —
 *  the dispatcher matches on this without parsing graphs on the hot path. */
export const FlowTriggerSchema = z.discriminatedUnion('type', [
  TriggerRecordNodeSchema,
  TriggerScheduledNodeSchema,
  TriggerWebhookNodeSchema,
]);

export type FlowTrigger = z.infer<typeof FlowTriggerSchema>;

export const FLOW_TRIGGER_NODE_TYPES = [
  'trigger_record',
  'trigger_scheduled',
  'trigger_webhook',
] as const;

/* ── Logic nodes ────────────────────────────────────────────────────────── */

const DecisionOutcomeSchema = z.object({
  /** Edge sourceHandle for this outcome. 'default' is the reserved
   *  fall-through handle. */
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/, 'lowercase outcome id')
    .refine((id) => id !== 'default', "'default' is the reserved fall-through handle"),
  label: z.string().min(1).max(60),
  condition: FlowConditionSchema,
});

const DecisionNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('decision'),
  config: z
    .object({
      /** Evaluated in order; the first truthy outcome's edge is taken, else
       *  the 'default' edge (or the run ends here). */
      outcomes: z.array(DecisionOutcomeSchema).min(1).max(10),
    })
    .superRefine((config, ctx) => {
      const ids = new Set<string>();
      for (const outcome of config.outcomes) {
        if (ids.has(outcome.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate outcome id '${outcome.id}'`,
          });
        }
        ids.add(outcome.id);
      }
    }),
});

const AssignmentNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('assignment'),
  config: z.object({
    assignments: z
      .array(z.object({ target: FlowAssignTargetSchema, value: FlowValueSchema }))
      .min(1)
      .max(20),
  }),
});

const GetRecordsNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('get_records'),
  config: z.object({
    objectKey: z.string().min(1),
    filters: z.array(FlowFilterSchema).max(10).optional(),
    /** AND when absent. */
    logic: z.enum(['and', 'or']).optional(),
    sort: z.object({ fieldKey: z.string().min(1), direction: z.enum(['asc', 'desc']) }).optional(),
    limit: z.number().int().min(1).max(FLOW_LIMITS.maxGetRecords),
    assignTo: VarNameSchema,
  }),
});

const LoopNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('loop'),
  /** Iterates a var holding get_records results; the current item is the
   *  `{{loopItem.*}}` template scope. Edges: 'body' (per item), 'done' (after
   *  the last), plus an explicit back-edge from the body to this node. */
  config: z.object({ sourceVar: VarNameSchema }),
});

const WaitUnitSchema = z.enum(['minutes', 'hours', 'days']);
const YEAR_MINUTES = 525_600;

const WaitNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('wait'),
  config: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('duration'),
      amount: z.number().int().min(1).max(YEAR_MINUTES),
      unit: WaitUnitSchema,
    }),
    z.object({
      kind: z.literal('until'),
      /** ISO datetime or a `{{merge}}` resolving to one. */
      at: z.string().min(1).max(200),
    }),
    z.object({
      /** SF "scheduled paths": offset from a date/datetime field on the
       *  trigger record, re-read at fire time. */
      kind: z.literal('relative_to_field'),
      fieldKey: z.string().min(1),
      /** Negative = before the field's time. */
      offset: z.number().int().min(-YEAR_MINUTES).max(YEAR_MINUTES),
      unit: WaitUnitSchema,
    }),
  ]),
});

/* ── Action nodes ───────────────────────────────────────────────────────── */

const UpdateRecordsNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('update_records'),
  config: z.object({ target: FlowUpdateTargetSchema, fields: FieldValuesSchema }),
});

const CreateRecordNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('create_record'),
  config: z.object({
    objectKey: z.string().min(1),
    fields: FieldValuesSchema,
    /** Store the created record for later nodes ({{vars.<name>.id}} etc.). */
    assignTo: VarNameSchema.optional(),
  }),
});

const DeleteRecordNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('delete_record'),
  config: z.object({ target: FlowRecordTargetSchema }),
});

const AssignOwnerNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('assign_owner'),
  config: z.object({
    target: FlowRecordTargetSchema,
    owner: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('user'), userId: z.string().min(1) }),
      /** A `{{merge}}` resolving to a member's user id. */
      z.object({ kind: z.literal('template'), value: TemplateStringSchema }),
    ]),
  }),
});

const SendEmailNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('send_email'),
  config: z.object({
    /** Addresses or `{{merge}}`s resolving to addresses. */
    to: z.array(z.string().min(1).max(320)).min(1).max(10),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
  }),
});

const PostTimelineNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('post_timeline'),
  /** System note on the target record's activity timeline. */
  config: z.object({ target: FlowRecordTargetSchema, body: z.string().min(1).max(4000) }),
});

const NotifyRecipientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string().min(1) }),
  /** Owner of the trigger record (or loop item inside a loop body). */
  z.object({ kind: z.literal('record_owner') }),
  /** A `{{merge}}` resolving to a member's user id. */
  z.object({ kind: z.literal('template'), value: TemplateStringSchema }),
]);

export type FlowNotifyRecipient = z.infer<typeof NotifyRecipientSchema>;

const NotifyNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('notify'),
  config: z.object({
    recipients: z.array(NotifyRecipientSchema).min(1).max(10),
    title: z.string().min(1).max(140),
    body: z.string().max(1000).optional(),
    /** In-app path or absolute URL. */
    link: z.string().max(500).optional(),
  }),
});

const WebhookOutNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('webhook_out'),
  config: z.object({
    /** https only (the runtime SSRF guard re-validates after interpolation);
     *  a leading `{{merge}}` defers the check to run time. */
    url: z
      .string()
      .min(1)
      .max(2000)
      .refine(
        (url) => url.startsWith('https://') || url.startsWith('{{'),
        'url must start with https://',
      ),
    method: z.enum(['POST', 'PUT', 'PATCH', 'GET', 'DELETE']),
    headers: z
      .record(z.string().min(1).max(80), z.string().max(500))
      .refine((headers) => Object.keys(headers).length <= 10, 'at most 10 headers')
      .optional(),
    body: z.string().max(10_000).optional(),
  }),
});

const AiPromptSchema = z.string().min(1).max(8000);

/** Tool ids an agent_step may use — validated against the AI_TOOLS catalog
 *  (same package) so the flow contract can't reference a tool that doesn't
 *  exist. run_query is excluded: the flow executor doesn't host the full
 *  QuerySpec engine (aggregate_records covers the analytical cases). */
export const AGENT_STEP_TOOL_IDS = [
  'search_records',
  'aggregate_records',
  'get_record',
  'inspect_metadata',
  'create_record',
  'update_record',
  'delete_record',
] as const;

const AgentStepNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('agent_step'),
  /** "Pass to agent": a bounded, HEADLESS tool-use loop. No approval chips —
   *  the explicit toolIds allowlist is the consent; every write goes through
   *  the flow record pipeline (validation + audit + depth+1 dispatch), so an
   *  agent can never do what a flow couldn't. Inert without ANTHROPIC_API_KEY. */
  config: z.object({
    /** ai_agent preset key (org slug) the step runs as — supplies the system
     *  prompt and narrows tools. Absent = the base automation agent. */
    agentKey: z.string().min(1).max(80).optional(),
    /** The job, template-interpolated ({{record.*}}, {{vars.*}}, …). */
    mission: z.string().min(1).max(4000),
    /** Explicit allowlist — read-only by default in the panel; writes are an
     *  author decision, not an agent one. */
    toolIds: z.array(z.enum(AGENT_STEP_TOOL_IDS)).min(1).max(7),
    /** Tool-call budget for the loop (model turns are budget+1). */
    maxToolCalls: z.number().int().min(1).max(10).optional(),
    /** Where the agent's final report lands. */
    output: FlowAssignTargetSchema.optional(),
  }),
});

const AiStepNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('ai_step'),
  /** Inert (node fails with `ai_not_configured`) without ANTHROPIC_API_KEY. */
  config: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('classify'),
      prompt: AiPromptSchema,
      options: z.array(z.string().min(1).max(80)).min(2).max(20),
      output: FlowAssignTargetSchema,
    }),
    z.object({
      mode: z.literal('extract'),
      prompt: AiPromptSchema,
      output: FlowAssignTargetSchema,
    }),
    z.object({ mode: z.literal('draft'), prompt: AiPromptSchema, output: FlowAssignTargetSchema }),
  ]),
});

/* ── Graph ──────────────────────────────────────────────────────────────── */

export const FLOW_NODE_TYPES = [
  'trigger_record',
  'trigger_scheduled',
  'trigger_webhook',
  'decision',
  'assignment',
  'get_records',
  'loop',
  'wait',
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
] as const;

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

export const FlowNodeSchema = z.discriminatedUnion('type', [
  TriggerRecordNodeSchema,
  TriggerScheduledNodeSchema,
  TriggerWebhookNodeSchema,
  DecisionNodeSchema,
  AssignmentNodeSchema,
  GetRecordsNodeSchema,
  LoopNodeSchema,
  WaitNodeSchema,
  UpdateRecordsNodeSchema,
  CreateRecordNodeSchema,
  DeleteRecordNodeSchema,
  AssignOwnerNodeSchema,
  SendEmailNodeSchema,
  PostTimelineNodeSchema,
  NotifyNodeSchema,
  WebhookOutNodeSchema,
  AiStepNodeSchema,
  AgentStepNodeSchema,
]);

export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowNodeOfType<T extends FlowNodeType> = Extract<FlowNode, { type: T }>;

export function isFlowTriggerNode(node: FlowNode): node is FlowTrigger {
  return (
    node.type === 'trigger_record' ||
    node.type === 'trigger_scheduled' ||
    node.type === 'trigger_webhook'
  );
}

export const FlowEdgeSchema = z.object({
  id: z.string().min(1).max(64),
  source: NodeIdSchema,
  target: NodeIdSchema,
  /** Branch handle: a decision outcome id or 'default'; 'body' or 'done' on a
   *  loop. Absent on single-exit nodes. */
  sourceHandle: z.string().min(1).max(64).optional(),
});

export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowGraphSchema = z
  .object({
    nodes: z.array(FlowNodeSchema).min(1).max(FLOW_LIMITS.maxNodes),
    edges: z.array(FlowEdgeSchema).max(FLOW_LIMITS.maxEdges),
  })
  .superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate node id '${node.id}'` });
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate edge id '${edge.id}'` });
      }
      edgeIds.add(edge.id);
    }
  });

export type FlowGraph = z.infer<typeof FlowGraphSchema>;

/* ── Lenient draft schemas ──────────────────────────────────────────────────
   Drafts are allowed to be config-INCOMPLETE (createDefaultNode seeds empty
   objectKey/fields/etc. that panels fill in later), so draft persistence
   validates only the graph SHAPE — node/edge ids, known node types, size
   caps, duplicate-id rejection — and stores configs opaquely. Activation is
   the strict gate: it re-parses with FlowGraphSchema + validateFlowGraph. */

export const FlowDraftNodeSchema = z.object({
  id: NodeIdSchema,
  type: z.enum(FLOW_NODE_TYPES),
  /** Opaque in drafts — may be partial; FlowNodeSchema re-checks on activate. */
  config: z.record(z.string(), z.unknown()),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
});

export type FlowDraftNode = z.infer<typeof FlowDraftNodeSchema>;

export const FlowDraftTriggerSchema = FlowDraftNodeSchema.extend({
  type: z.enum(FLOW_TRIGGER_NODE_TYPES),
});

export type FlowDraftTrigger = z.infer<typeof FlowDraftTriggerSchema>;

export const FlowDraftGraphSchema = z
  .object({
    nodes: z.array(FlowDraftNodeSchema).min(1).max(FLOW_LIMITS.maxNodes),
    edges: z.array(FlowEdgeSchema).max(FLOW_LIMITS.maxEdges),
  })
  .superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate node id '${node.id}'` });
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of graph.edges) {
      if (edgeIds.has(edge.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate edge id '${edge.id}'` });
      }
      edgeIds.add(edge.id);
    }
  });

export type FlowDraftGraph = z.infer<typeof FlowDraftGraphSchema>;

/* ── Structural validation ──────────────────────────────────────────────────
   Pure graph-shape rules shared verbatim by the canvas (badges on every
   change) and the server (activate gate). Metadata rules (fields exist,
   formulas parse, template refs resolve) live in the api's automation.validate
   because they need the org's metadata. */

export type FlowIssue = {
  nodeId?: string;
  message: string;
  severity: 'error' | 'warning';
};

export type FlowValidationResult =
  | { ok: true; issues: FlowIssue[] }
  | { ok: false; issues: FlowIssue[] };

export function validateFlowGraph(graph: FlowGraph): FlowValidationResult {
  const issues: FlowIssue[] = [];
  const error = (message: string, nodeId?: string) =>
    issues.push({ nodeId, message, severity: 'error' });
  const warning = (message: string, nodeId?: string) =>
    issues.push({ nodeId, message, severity: 'warning' });

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // Exactly one trigger.
  const triggers = graph.nodes.filter(isFlowTriggerNode);
  const trigger = triggers[0];
  if (!trigger) error('flow has no trigger node');
  for (const extra of triggers.slice(1)) error('flow can only have one trigger', extra.id);

  // Every edge resolves to existing nodes; triggers have no inbound edges.
  const validEdges: FlowEdge[] = [];
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    let bad = false;
    if (!source) {
      error(`edge '${edge.id}' points from unknown node '${edge.source}'`);
      bad = true;
    }
    if (!target) {
      error(`edge '${edge.id}' points to unknown node '${edge.target}'`);
      bad = true;
    } else if (isFlowTriggerNode(target)) {
      error(`edge '${edge.id}' targets the trigger — triggers have no inputs`, target.id);
      bad = true;
    }
    if (!bad) validEdges.push(edge);
  }

  const outbound = new Map<string, FlowEdge[]>();
  for (const edge of validEdges) {
    const list = outbound.get(edge.source);
    if (list) list.push(edge);
    else outbound.set(edge.source, [edge]);
  }

  // Per-node exit rules.
  for (const node of graph.nodes) {
    const outs = outbound.get(node.id) ?? [];
    if (node.type === 'decision') {
      const outcomeIds = new Set(node.config.outcomes.map((o) => o.id));
      for (const outcome of node.config.outcomes) {
        const count = outs.filter((e) => e.sourceHandle === outcome.id).length;
        if (count === 0) error(`decision outcome '${outcome.label}' has no edge`, node.id);
        if (count > 1) error(`decision outcome '${outcome.label}' has ${count} edges`, node.id);
      }
      const defaults = outs.filter((e) => e.sourceHandle === 'default').length;
      if (defaults > 1) error(`decision has ${defaults} default edges`, node.id);
      if (defaults === 0) {
        warning('decision has no default edge; unmatched runs end here', node.id);
      }
      for (const edge of outs) {
        if (!edge.sourceHandle) {
          error(`edge '${edge.id}' from a decision needs an outcome handle`, node.id);
        } else if (edge.sourceHandle !== 'default' && !outcomeIds.has(edge.sourceHandle)) {
          error(`edge '${edge.id}' references unknown outcome '${edge.sourceHandle}'`, node.id);
        }
      }
    } else if (node.type === 'loop') {
      const bodyEdges = outs.filter((e) => e.sourceHandle === 'body').length;
      const doneEdges = outs.filter((e) => e.sourceHandle === 'done').length;
      if (bodyEdges !== 1)
        error(`loop needs exactly one 'body' edge (found ${bodyEdges})`, node.id);
      if (doneEdges !== 1)
        error(`loop needs exactly one 'done' edge (found ${doneEdges})`, node.id);
      for (const edge of outs) {
        if (edge.sourceHandle !== 'body' && edge.sourceHandle !== 'done') {
          error(`edge '${edge.id}' from a loop must use the 'body' or 'done' handle`, node.id);
        }
      }
    } else {
      if (outs.length > 1) {
        error(`'${node.type}' can only have one outgoing edge (found ${outs.length})`, node.id);
      }
      for (const edge of outs) {
        if (edge.sourceHandle) {
          error(
            `edge '${edge.id}' has a branch handle but '${node.type}' has no branches`,
            node.id,
          );
        }
      }
    }
  }

  // Loop bodies: nodes reachable from the 'body' edge without passing back
  // through the loop node itself.
  const loops = graph.nodes.filter((n) => n.type === 'loop');
  const bodyOf = new Map<string, Set<string>>();
  for (const loop of loops) {
    const body = new Set<string>();
    const bodyEdge = (outbound.get(loop.id) ?? []).find((e) => e.sourceHandle === 'body');
    if (bodyEdge) {
      const stack = [bodyEdge.target];
      for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
        if (id === loop.id || body.has(id)) continue;
        body.add(id);
        for (const edge of outbound.get(id) ?? []) stack.push(edge.target);
      }
    }
    bodyOf.set(loop.id, body);
  }

  // The loop back-edge (body → loop) must exist, and is the ONLY legal cycle.
  const backEdgeIds = new Set<string>();
  for (const loop of loops) {
    const body = bodyOf.get(loop.id) ?? new Set<string>();
    const backs = validEdges.filter((e) => e.target === loop.id && body.has(e.source));
    if (body.size > 0 && backs.length === 0) {
      error(
        'loop body never returns — add an edge from the last body node back to the loop',
        loop.id,
      );
    }
    for (const back of backs) backEdgeIds.add(back.id);
  }

  // With back-edges removed the graph must be acyclic.
  const adjacency = new Map<string, string[]>();
  for (const edge of validEdges) {
    if (backEdgeIds.has(edge.id)) continue;
    const list = adjacency.get(edge.source);
    if (list) list.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycleReported = false;
  const dfs = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      if (!cycleReported) {
        error('cycle detected — only a loop back-edge may point upstream', id);
        cycleReported = true;
      }
      return;
    }
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) dfs(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of graph.nodes) dfs(node.id);

  // Everything hangs off the trigger.
  if (trigger) {
    const reachable = new Set<string>([trigger.id]);
    const stack = [trigger.id];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      for (const edge of outbound.get(id) ?? []) {
        if (reachable.has(edge.target)) continue;
        reachable.add(edge.target);
        stack.push(edge.target);
      }
    }
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) error('node is not reachable from the trigger', node.id);
    }
    if (graph.nodes.length === 1) warning('flow has no steps after the trigger', trigger.id);
  }

  // Loop nesting cap.
  for (const loop of loops) {
    let depth = 1;
    for (const other of loops) {
      if (other.id !== loop.id && bodyOf.get(other.id)?.has(loop.id)) depth += 1;
    }
    if (depth > FLOW_LIMITS.maxLoopNesting) {
      error(`loops can only nest ${FLOW_LIMITS.maxLoopNesting} deep`, loop.id);
    }
  }

  // relative_to_field re-reads the trigger record at fire time, so it needs a
  // record trigger — and the record must still exist.
  for (const node of graph.nodes) {
    if (node.type !== 'wait' || node.config.kind !== 'relative_to_field') continue;
    if (!trigger || trigger.type !== 'trigger_record') {
      error("wait 'relative to a field' requires a record trigger", node.id);
    } else if (trigger.config.event === 'deleted') {
      error("wait 'relative to a field' cannot follow a delete trigger", node.id);
    }
  }

  return issues.some((i) => i.severity === 'error') ? { ok: false, issues } : { ok: true, issues };
}
