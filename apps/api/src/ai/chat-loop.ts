// The chat-first agentic loop behind ai.chat — one streamText run in which
// the model converses with the user, may call the caller's permitted research
// tools (same approval broker + event channel as ai.preview), and reaches the
// EXISTING artifact pipeline through two extra tools:
//
//   compose_dashboard — full (re)composition: streamArtifact → repairArtifact;
//     the repaired tree is emitted to the client as an { type: 'artifact' }
//     event and the model gets back only a short summary string.
//   patch_dashboard  — small edits: applyArtifactPatch against the latest
//     artifact this turn (or the one the client sent), then repair + emit.
//
// Successive compose/patch calls in one turn CHAIN — createArtifactState
// keeps a mutable latest artifact so "compose it, then drop the table" works
// in a single generation. The pure policy helpers (model resolution, tool
// intersection, role gating, thread mapping) are exported for unit tests —
// none of them needs an LLM.

import { anthropic } from '@ai-sdk/anthropic';
import {
  type Artifact,
  type ArtifactLike,
  type ArtifactPatch,
  ArtifactPatchSchema,
  type EffectiveTool,
  isKnownModel,
} from '@northbeam/core';
import type { AiSessionMessage, FieldRow, ObjectRow, ObjectWithFields } from '@northbeam/db';
import { type ModelMessage, type Tool, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { applyArtifactPatch } from './apply-patch.js';
import { type DataSummary, type ObjectContext, streamArtifact } from './artifact-generator.js';
import { type ObjectFieldsByKey, repairArtifact } from './repair-artifact.js';
import { objectLines } from './research.js';

const MAX_STEPS = 8;

/* ── Pure policy helpers (unit-tested without an LLM) ─────────────────────── */

/** The models an agent may actually run on: its list filtered to the known
 *  catalog; an empty (or entirely unknown) list falls back to the org
 *  default model. Never returns an empty array. */
export function resolveAgentModels(agentModels: readonly string[], defaultModel: string): string[] {
  const known = agentModels.filter((id) => isKnownModel(id));
  return known.length > 0 ? known : [defaultModel];
}

/** The model a chat turn runs on: the caller's request when the agent allows
 *  it, otherwise the agent's first resolved model. */
export function pickChatModel(
  agentModels: readonly string[],
  defaultModel: string,
  requested?: string | null,
): string {
  const resolved = resolveAgentModels(agentModels, defaultModel);
  if (requested && resolved.includes(requested)) return requested;
  return resolved[0] ?? defaultModel;
}

/** Narrow the caller's effective tools to the agent's allowlist. Null means
 *  the agent doesn't narrow — everything the caller may use stays. The
 *  intersection can only ever REMOVE tools: an agent listing a tool the
 *  caller's role policy denies does not grant it. */
export function intersectTools(
  effective: EffectiveTool[],
  toolIds: readonly string[] | null,
): EffectiveTool[] {
  if (toolIds === null) return effective;
  const wanted = new Set(toolIds);
  return effective.filter((t) => wanted.has(t.id));
}

/** Role gate for agents: null roleKeys = everyone; owners always see all. */
export function agentVisibleToRole(
  roleKeys: readonly string[] | null,
  role: string,
  isOwner: boolean,
): boolean {
  if (isOwner) return true;
  return roleKeys === null || roleKeys.includes(role);
}

/** Map a persisted thread onto model messages. Text turns pass through;
 *  tool/artifact turns become short assistant markers — enough context to
 *  keep the conversation coherent without replaying tool payloads. */
export function mapThreadToModelMessages(messages: readonly AiSessionMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.kind === 'tool') {
      const status = m.status === 'done' ? '' : ` — ${m.status}`;
      out.push({ role: 'assistant', content: `[ran tool ${m.toolId}${status}]` });
    } else if (m.kind === 'artifact') {
      out.push({
        role: 'assistant',
        content: m.note ? `[composed dashboard: ${m.note}]` : '[composed dashboard]',
      });
    } else if (m.content.trim().length > 0) {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/* ── Artifact state — compose/patch chaining within one turn ──────────────── */

export type ArtifactStateResult = { artifact: Artifact; repairs: string[] };

/** Mutable latest-artifact holder shared by compose_dashboard and
 *  patch_dashboard: every application repairs against live metadata, stores
 *  the repaired tree as the new base, and accumulates repair notes. */
export function createArtifactState(opts: {
  initial?: ArtifactLike;
  objectFields: ObjectFieldsByKey;
  mode: 'dashboard' | 'detail';
  baseObjectKey?: string;
}) {
  let current: ArtifactLike | undefined = opts.initial;
  let latestRepaired: Artifact | null = null;
  const allRepairs: string[] = [];

  const repairAndStore = (artifact: Artifact, extraNotes: string[]): ArtifactStateResult => {
    const repaired = repairArtifact(artifact, opts.objectFields, {
      mode: opts.mode,
      baseObjectKey: opts.baseObjectKey,
    });
    const repairs = [...repaired.notes, ...extraNotes];
    current = repaired.artifact;
    latestRepaired = repaired.artifact;
    allRepairs.push(...repairs);
    return { artifact: repaired.artifact, repairs };
  };

  const applyOps = (base: ArtifactLike, ops: ArtifactPatch): ArtifactStateResult => {
    const patched = applyArtifactPatch(base, ops);
    const notes =
      patched.skipped > 0
        ? [`${patched.skipped} edit(s) referenced components that no longer exist`]
        : [];
    return repairAndStore(patched.artifact as Artifact, notes);
  };

  return {
    /** The base the NEXT compose/patch chains from. */
    get current(): ArtifactLike | undefined {
      return current;
    },
    /** The last repaired tree this turn produced (null = none yet). */
    get repaired(): Artifact | null {
      return latestRepaired;
    },
    /** Every repair note accumulated this turn. */
    get repairs(): string[] {
      return [...allRepairs];
    },
    /** A full generation reply: an artifact, or patch ops against the current
     *  tree. Null when the generation carried neither (note-only reply). */
    applyGeneration(gen: {
      artifact?: Artifact;
      patch?: ArtifactPatch;
    }): ArtifactStateResult | null {
      if (gen.patch && current) return applyOps(current, gen.patch);
      if (gen.artifact) return repairAndStore(gen.artifact, []);
      return null;
    },
    /** Direct patch ops (patch_dashboard). Null when there is nothing to
     *  patch yet. */
    applyPatch(ops: ArtifactPatch): ArtifactStateResult | null {
      if (!current) return null;
      return applyOps(current, ops);
    },
  };
}

export type ArtifactState = ReturnType<typeof createArtifactState>;

/* ── System prompt ─────────────────────────────────────────────────────────── */

/** The loop's system prompt: the agent's own prompt (when set) on top of a
 *  fixed harness section — identity, readable objects, tool discipline, and
 *  when to reach for compose_dashboard vs patch_dashboard vs plain text. */
export function buildChatSystemPrompt(opts: {
  agentName: string;
  agentPrompt: string;
  objects: ObjectWithFields[];
  mode: 'dashboard' | 'detail';
  currentArtifact?: ArtifactLike;
}): string {
  const custom = opts.agentPrompt.trim();
  const currentSection = opts.currentArtifact
    ? `

Current dashboard on screen, top-level components BY INDEX (patch_dashboard
ops target these; an insert shifts later indices):
${opts.currentArtifact.components.map((c, i) => `[${i}] ${JSON.stringify(c)}`).join('\n')}`
    : '';
  return `${custom ? `${custom}\n\n` : ''}# Northbeam harness

You are ${opts.agentName}, an AI agent inside Northbeam, the user's CRM
workspace. You chat with the user, look at their real data through tools, and
compose live dashboards when asked.

Objects you can read (use these exact objectKeys and field keys):
${objectLines(opts.objects) || '- (none — you cannot read any objects)'}

Tool discipline:
- Read tools ground your answers in real data — use them when the answer
  depends on the data, not reflexively.
- Write tools (create_record / update_record / delete_record), when present,
  run REAL mutations after the user approves each call in the thread. Use one
  ONLY on an explicit instruction — never speculatively. Approvals may be
  denied; continue gracefully without the call.
- When the user wants a dashboard, report, or ${
    opts.mode === 'detail' ? 'record-page layout' : 'page layout'
  }, call compose_dashboard ONCE with one crisp, self-contained instruction —
  fold in entity names/ids and time windows you learned from research.
- For small edits to the dashboard already on screen ("wider chart", "drop
  the table"), call patch_dashboard with targeted ops instead of recomposing.
- Otherwise just answer in text: short, concrete, citing the real numbers you
  fetched. Ask ONE crisp question when the request is genuinely ambiguous.${currentSection}`;
}

/* ── The loop ─────────────────────────────────────────────────────────────── */

export type ChatStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'artifact'; artifact: Artifact; repairs: string[] };

export type ChatComposeContext = {
  /** Null = workspace scope: no single target object. */
  object: ObjectRow | null;
  fields: FieldRow[];
  otherObjects: ObjectContext[];
  summary: DataSummary | null;
  /** Ground truth for the repair pass — every readable object's fields. */
  objectFields: ObjectFieldsByKey;
  mode: 'dashboard' | 'detail';
  baseObjectKey?: string;
  currentArtifact?: ArtifactLike;
};

export type ChatLoopResult = { text: string; artifact: Artifact | null; repairs: string[] };

/** Run one chat turn. Research-tool lifecycle events flow through the tools'
 *  own emit (wired by the caller); this loop emits text deltas and artifact
 *  snapshots through `emit`. Resolves with the final text + the last repaired
 *  artifact (null when the turn composed nothing). */
export async function runChatLoop(opts: {
  model: string;
  agent: { name: string; systemPrompt: string };
  prompt: string;
  priorMessages: readonly AiSessionMessage[];
  objects: ObjectWithFields[];
  researchTools: Record<string, Tool>;
  compose: ChatComposeContext;
  emit: (ev: ChatStreamEvent) => void;
}): Promise<ChatLoopResult> {
  const state = createArtifactState({
    initial: opts.compose.currentArtifact,
    objectFields: opts.compose.objectFields,
    mode: opts.compose.mode,
    baseObjectKey: opts.compose.baseObjectKey,
  });

  const emitApplied = (applied: ArtifactStateResult, verb: string): string => {
    opts.emit({ type: 'artifact', artifact: applied.artifact, repairs: applied.repairs });
    const repairs = applied.repairs.length ? `; repairs: ${applied.repairs.join('; ')}` : '';
    return `${verb}: ${applied.artifact.components.length} components${repairs}`;
  };

  const compose_dashboard = tool({
    description:
      'Compose (or fully rebuild) the live dashboard/layout from one crisp instruction. Runs the full composition pipeline against real metadata and data. Use patch_dashboard for small edits instead.',
    inputSchema: z.object({
      instruction: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          'Self-contained composition brief: what to show, entities by exact id/name, time windows.',
        ),
    }),
    execute: async ({ instruction }) => {
      try {
        const stream = streamArtifact({
          prompt: instruction,
          object: opts.compose.object,
          fields: opts.compose.fields,
          summary: opts.compose.summary,
          otherObjects: opts.compose.otherObjects,
          mode: opts.compose.mode,
          currentArtifact: state.current,
        });
        for await (const _partial of stream.partialStream) {
          // Drain — the result promise resolves only after the stream ends.
        }
        const generation = await stream.result;
        const applied = state.applyGeneration(generation);
        if (!applied) {
          return generation.note
            ? `nothing composed — the composer replied: ${generation.note}`
            : 'nothing composed';
        }
        return emitApplied(applied, 'composed');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'compose failed';
        return `compose failed: ${message}. Answer in text instead.`;
      }
    },
  });

  const patch_dashboard = tool({
    description:
      'Apply small edits to the current dashboard: replace/insert/remove a top-level component by index, or shallow-merge its props (a null prop value deletes the key). Ops apply sequentially — an insert shifts later indices.',
    inputSchema: z.object({ ops: ArtifactPatchSchema }),
    execute: async ({ ops }) => {
      const applied = state.applyPatch(ops);
      if (!applied) return 'no dashboard to patch yet — call compose_dashboard first.';
      return emitApplied(applied, 'patched');
    },
  });

  const result = streamText({
    model: anthropic(opts.model),
    system: buildChatSystemPrompt({
      agentName: opts.agent.name,
      agentPrompt: opts.agent.systemPrompt,
      objects: opts.objects,
      mode: opts.compose.mode,
      currentArtifact: opts.compose.currentArtifact,
    }),
    messages: [
      ...mapThreadToModelMessages(opts.priorMessages),
      { role: 'user', content: opts.prompt },
    ],
    tools: { ...opts.researchTools, compose_dashboard, patch_dashboard },
    stopWhen: stepCountIs(MAX_STEPS),
  });

  for await (const delta of result.textStream) {
    if (delta) opts.emit({ type: 'text-delta', delta });
  }
  const text = (await result.text).trim();
  return { text, artifact: state.repaired, repairs: state.repairs };
}
