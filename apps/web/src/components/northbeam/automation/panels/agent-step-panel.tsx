'use client';

// Agent step config — "pass to agent". Picks an ai_agent preset, states the
// mission (merge-field textarea), and allowlists tools. The allowlist is the
// consent: the loop runs headless (no approval chips), so write tools are an
// explicit author decision, defaulting off. The agent's final report lands in
// a flow variable or an in-memory record field, same contract as AI step.

import { Field } from '@/components/northbeam/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/api';
import { AI_TOOLS } from '@northbeam/core/ai-tools';
import {
  AGENT_STEP_TOOL_IDS,
  type FlowAssignTarget,
  type FlowNodeOfType,
} from '@northbeam/core/flow';
import { useId } from 'react';
import { MergeFieldTextarea } from '../merge-field-input';
import { type FlowPanelMeta, VarNameField, writableFields } from './shared';

type AgentStepConfig = FlowNodeOfType<'agent_step'>['config'];
type AgentToolId = (typeof AGENT_STEP_TOOL_IDS)[number];

const NONE = '__none__';

export function AgentStepPanel({
  config,
  onConfig,
  meta,
}: {
  config: AgentStepConfig;
  onConfig: (next: AgentStepConfig) => void;
  meta: FlowPanelMeta;
}) {
  const agentId = useId();
  const budgetId = useId();
  const agents = trpc.automation.agents.useQuery(undefined, { meta: { silent: true } });

  const toggleTool = (id: AgentToolId, on: boolean) => {
    const next = on ? [...config.toolIds, id] : config.toolIds.filter((t) => t !== id);
    onConfig({ ...config, toolIds: next });
  };
  const output: FlowAssignTarget = config.output ?? { scope: 'vars', name: 'agent_report' };
  const setOutput = (next: FlowAssignTarget) => onConfig({ ...config, output: next });

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Run as"
        htmlFor={agentId}
        description="An agent preset supplies its system prompt and can narrow the tools."
      >
        <Select
          value={config.agentKey ?? NONE}
          onValueChange={(v) =>
            onConfig(v === NONE ? { ...config, agentKey: undefined } : { ...config, agentKey: v })
          }
        >
          <SelectTrigger id={agentId} className="w-full">
            <SelectValue placeholder="Base automation agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Base automation agent</SelectItem>
            {(agents.data ?? []).map((a) => (
              <SelectItem key={a.key} value={a.key}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Mission">
        <MergeFieldTextarea
          value={config.mission}
          onChange={(mission) => onConfig({ ...config, mission })}
          paths={meta.mergePaths}
          rows={5}
          aria-label="Mission"
          placeholder="Review {{record.name}}'s open tasks and summarize the account risk…"
        />
      </Field>

      <Field
        label="Tools"
        description="What the agent may do — writes are real, validated, and audited."
      >
        <div className="flex flex-col gap-1.5">
          {AGENT_STEP_TOOL_IDS.map((id) => {
            const def = AI_TOOLS.find((t) => t.id === id);
            if (!def) return null;
            const checked = config.toolIds.includes(id);
            return (
              <label key={id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => toggleTool(id, v === true)}
                  aria-label={def.title}
                />
                <span className="flex-1">{def.title}</span>
                {def.kind !== 'read' && (
                  <span className="text-muted-foreground text-xs">
                    {def.kind === 'destructive' ? 'destructive' : 'write'}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </Field>

      <Field
        label="Tool call budget"
        htmlFor={budgetId}
        description="Max tool calls before the agent must report (1–10)."
      >
        <Input
          id={budgetId}
          type="number"
          min={1}
          max={10}
          value={config.maxToolCalls ?? 5}
          onChange={(e) => {
            const n = Number(e.target.value);
            onConfig({
              ...config,
              maxToolCalls: Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 10) : 5,
            });
          }}
        />
      </Field>

      <Field label="Store report in">
        <Select
          value={output.scope}
          onValueChange={(scope) =>
            setOutput(
              scope === 'vars'
                ? { scope: 'vars', name: 'agent_report' }
                : { scope: 'record', fieldKey: meta.fields[0]?.key ?? '' },
            )
          }
        >
          <SelectTrigger aria-label="Report scope" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vars">A flow variable</SelectItem>
            <SelectItem value="record">A record field (in-memory)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {output.scope === 'vars' ? (
        <VarNameField
          label="Variable"
          value={output.name}
          onChange={(name) => setOutput({ scope: 'vars', name })}
        />
      ) : (
        <Field label="Field" description="Add an Update records step to persist it.">
          <Select
            value={output.fieldKey || undefined}
            onValueChange={(fieldKey) => setOutput({ scope: 'record', fieldKey })}
          >
            <SelectTrigger aria-label="Report field" className="w-full">
              <SelectValue placeholder="Choose field…" />
            </SelectTrigger>
            <SelectContent>
              {writableFields(meta.fields).map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}
