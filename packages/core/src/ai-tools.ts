// AI tool catalog — the CLOSED set of tools the composer's research phase may
// call, and the policy math that decides who gets which. Three layers:
//
//   1. This catalog (code): every tool that exists, with its risk kind.
//   2. Org policy (admin-set, per role): which tools a role's AI may use at
//      all. Default: read tools allowed for everyone; anything riskier ships
//      disabled until an admin turns it on.
//   3. User preference: which allowed tools run WITHOUT asking. A tool that
//      is allowed but not auto-approved pauses generation and asks in the
//      composer thread (Claude-style approve/deny chip).
//
// Execution always happens server-side through the same ACL'd + permission-
// gated helpers the tRPC record procedures use — policy here decides
// AVAILABILITY and FRICTION, never bypasses enforcement.

export type AiToolKind = 'read' | 'write' | 'destructive';

export type AiToolDef = {
  id: string;
  title: string;
  /** Shown to admins/users AND to the model as the tool description. */
  description: string;
  kind: AiToolKind;
};

export const AI_TOOLS: readonly AiToolDef[] = [
  {
    id: 'search_records',
    title: 'Search records',
    description:
      'List records of one object with filters, sort, and a text search — for looking at real rows while composing.',
    kind: 'read',
  },
  {
    id: 'aggregate_records',
    title: 'Aggregate records',
    description:
      'Group-by aggregation over one object (count/sum/avg/min/max/median/distinct, up to two groupings, date grains, having).',
    kind: 'read',
  },
  {
    id: 'run_query',
    title: 'Run analysis query',
    description:
      'The full declarative query engine: multiple measures, computed ratios, EXISTS/NOT-EXISTS related-record conditions, AND/OR trees.',
    kind: 'read',
  },
  {
    id: 'get_record',
    title: 'Read one record',
    description: 'Fetch a single record by id with all its field values.',
    kind: 'read',
  },
  {
    id: 'inspect_metadata',
    title: 'Inspect metadata',
    description:
      'Field definitions for an object — types, picklist options, required flags, reference targets. No record data.',
    kind: 'read',
  },
  // Write tools ship DISABLED for non-admin roles and NEVER auto-approve by
  // default — every call renders an Allow/Deny in the thread. Execution runs
  // the exact validation + permission path the human mutation endpoints use.
  {
    id: 'create_record',
    title: 'Create a record',
    description:
      'Create one record with the given field values — full validation, required-field and rule checks apply.',
    kind: 'write',
  },
  {
    id: 'update_record',
    title: 'Update a record',
    description:
      'Patch fields on one existing record by id — validation runs on the merged result.',
    kind: 'write',
  },
  // Destructive: disabled for EVERY role by default (owners always have it);
  // owners/role-managers grant it per role in the matrix. Approval is
  // required on every call for everyone except owners.
  {
    id: 'delete_record',
    title: 'Delete a record',
    description: 'Permanently delete one record by id. Irreversible.',
    kind: 'destructive',
  },
] as const;

export const AI_TOOL_IDS = AI_TOOLS.map((t) => t.id);

export type AiToolPolicyRow = { roleKey: string; toolId: string; allowed: boolean };
export type AiToolPrefRow = { toolId: string; autoApprove: boolean };

/** Is `toolId` allowed for `roleKey` under the org's policy rows? Explicit
 *  row wins; otherwise read tools default allowed, write tools default to
 *  admin-ish roles only. Owners always pass (same rule as everywhere). */
export function toolAllowedForRole(
  policy: readonly AiToolPolicyRow[],
  tool: AiToolDef,
  roleKey: string,
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  const row = policy.find((p) => p.roleKey === roleKey && p.toolId === tool.id);
  if (row) return row.allowed;
  if (tool.kind === 'read') return true;
  if (tool.kind === 'write') return roleKey === 'admin';
  return false; // destructive: nobody by default — owners bypass above
}

/** Default auto-approval when the user hasn't chosen: read tools run without
 *  asking; write tools always ask; destructive tools ask for EVERYONE except
 *  the owner (and even the owner can flip theirs off in prefs). */
export function toolAutoApproveDefault(tool: AiToolDef, isOwner: boolean): boolean {
  if (tool.kind === 'read') return true;
  if (tool.kind === 'destructive') return isOwner;
  return false;
}

export type EffectiveTool = AiToolDef & { autoApprove: boolean };

/** The tools this caller's AI may use, each with its friction setting. */
export function effectiveTools(
  policy: readonly AiToolPolicyRow[],
  prefs: readonly AiToolPrefRow[],
  roleKey: string,
  isOwner: boolean,
): EffectiveTool[] {
  return AI_TOOLS.filter((t) => toolAllowedForRole(policy, t, roleKey, isOwner)).map((t) => ({
    ...t,
    autoApprove:
      prefs.find((p) => p.toolId === t.id)?.autoApprove ?? toolAutoApproveDefault(t, isOwner),
  }));
}

/* ── Model catalog ──────────────────────────────────────────────────────────
   The models an org's agents may run on. The org default (env.ANTHROPIC_MODEL)
   is always usable; an agent's `models` list narrows the picker to a subset of
   these. Lives here (not its own module) so the API validation and the web
   picker share one import — and one that Turbopack demonstrably resolves. */

export const AVAILABLE_AI_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
] as const;

export type AiModel = (typeof AVAILABLE_AI_MODELS)[number];
export type AiModelId = AiModel['id'];

/** True when `id` names a model in the catalog. */
export function isKnownModel(id: string): id is AiModelId {
  return AVAILABLE_AI_MODELS.some((m) => m.id === id);
}
