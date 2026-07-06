'use client';

// The docked right-column config panel. Switches on the selected node's type
// (FlowNodeOfType narrows each config), writes full config replacements via
// editor.actions.updateNodeConfig, and hosts the shared name/description
// fields + the per-node issue list + Remove step.

import { Field } from '@/components/northbeam/field';
import { IconTile } from '@/components/northbeam/icon-tile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import type { FlowIssue, FlowNode } from '@northbeam/core/flow';
import { AlertCircle, AlertTriangle, Trash2, X } from 'lucide-react';
import { NODE_CATALOG } from '../node-catalog';
import type { FlowEditorActions } from '../use-flow-editor';
import {
  AssignOwnerPanel,
  CreateRecordPanel,
  DeleteRecordPanel,
  NotifyPanel,
  PostTimelinePanel,
  SendEmailPanel,
  UpdateRecordsPanel,
  WebhookOutPanel,
} from './action-panels';
import { AgentStepPanel } from './agent-step-panel';
import { AiStepPanel } from './ai-step-panel';
import { DecisionPanel } from './decision-panel';
import { AssignmentPanel, GetRecordsPanel, LoopPanel, WaitPanel } from './logic-panels';
import type { FlowPanelMeta } from './shared';
import { RecordTriggerPanel, ScheduledTriggerPanel, WebhookTriggerPanel } from './trigger-panel';

function NodeBody({
  node,
  meta,
  actions,
  collectionVars,
}: {
  node: FlowNode;
  meta: FlowPanelMeta;
  actions: FlowEditorActions;
  collectionVars: string[];
}) {
  switch (node.type) {
    case 'trigger_record':
      return (
        <RecordTriggerPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'trigger_record'>(node.id, c)}
          meta={meta}
        />
      );
    case 'trigger_scheduled':
      return (
        <ScheduledTriggerPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'trigger_scheduled'>(node.id, c)}
          meta={meta}
        />
      );
    case 'trigger_webhook':
      return <WebhookTriggerPanel meta={meta} />;
    case 'decision':
      return (
        <DecisionPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'decision'>(node.id, c)}
          meta={meta}
          onAddOutcome={() => actions.addOutcome(node.id)}
          onRemoveOutcome={(outcomeId) => actions.removeOutcome(node.id, outcomeId)}
          onMoveOutcome={(outcomeId, dir) => actions.moveOutcome(node.id, outcomeId, dir)}
        />
      );
    case 'assignment':
      return (
        <AssignmentPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'assignment'>(node.id, c)}
          meta={meta}
        />
      );
    case 'get_records':
      return (
        <GetRecordsPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'get_records'>(node.id, c)}
          meta={meta}
        />
      );
    case 'loop':
      return (
        <LoopPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'loop'>(node.id, c)}
          collectionVars={collectionVars}
        />
      );
    case 'wait':
      return (
        <WaitPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'wait'>(node.id, c)}
          meta={meta}
        />
      );
    case 'update_records':
      return (
        <UpdateRecordsPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'update_records'>(node.id, c)}
          meta={meta}
        />
      );
    case 'create_record':
      return (
        <CreateRecordPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'create_record'>(node.id, c)}
          meta={meta}
        />
      );
    case 'delete_record':
      return (
        <DeleteRecordPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'delete_record'>(node.id, c)}
        />
      );
    case 'assign_owner':
      return (
        <AssignOwnerPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'assign_owner'>(node.id, c)}
          meta={meta}
        />
      );
    case 'send_email':
      return (
        <SendEmailPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'send_email'>(node.id, c)}
          meta={meta}
        />
      );
    case 'post_timeline':
      return (
        <PostTimelinePanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'post_timeline'>(node.id, c)}
          meta={meta}
        />
      );
    case 'notify':
      return (
        <NotifyPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'notify'>(node.id, c)}
          meta={meta}
        />
      );
    case 'webhook_out':
      return (
        <WebhookOutPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'webhook_out'>(node.id, c)}
          meta={meta}
        />
      );
    case 'ai_step':
      return (
        <AiStepPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'ai_step'>(node.id, c)}
          meta={meta}
        />
      );
    case 'agent_step':
      return (
        <AgentStepPanel
          config={node.config}
          onConfig={(c) => actions.updateNodeConfig<'agent_step'>(node.id, c)}
          meta={meta}
        />
      );
  }
}

export function ConfigPanel({
  node,
  meta,
  actions,
  issues,
  collectionVars,
  onClose,
}: {
  node: FlowNode;
  meta: FlowPanelMeta;
  actions: FlowEditorActions;
  /** All current issues — filtered to this node here. */
  issues: FlowIssue[];
  /** get_records assignTo vars across the graph (loop source suggestions). */
  collectionVars: string[];
  onClose: () => void;
}) {
  const entry = NODE_CATALOG[node.type];
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);
  const isTrigger =
    node.type === 'trigger_record' ||
    node.type === 'trigger_scheduled' ||
    node.type === 'trigger_webhook';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <IconTile
          icon={entry.icon}
          tone={entry.tone === 'neutral' ? 'neutral' : entry.tone}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{entry.label}</div>
          <div className="truncate text-muted-foreground text-xs">{entry.hint}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <Field label="Step name" optional htmlFor={`node-name-${node.id}`}>
          <Input
            id={`node-name-${node.id}`}
            value={node.name ?? ''}
            placeholder={entry.label}
            maxLength={80}
            onChange={(e) => actions.updateNode(node.id, { name: e.target.value || undefined })}
          />
        </Field>

        {nodeIssues.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {nodeIssues.map((issue) => (
              <li
                key={issue.message}
                className="flex items-start gap-1.5 text-xs"
                style={{
                  color: issue.severity === 'error' ? 'var(--danger)' : 'var(--warning)',
                }}
              >
                {issue.severity === 'error' ? (
                  <AlertCircle className="mt-px size-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                )}
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        <Separator />

        {/* Remount per node so panel-local editing state reseeds. */}
        <NodeBody
          key={node.id}
          node={node}
          meta={meta}
          actions={actions}
          collectionVars={collectionVars}
        />
      </div>

      {!isTrigger && (
        <div className="border-t px-4 py-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => actions.removeNode(node.id)}
          >
            <Trash2 />
            Remove step
          </Button>
        </div>
      )}
    </div>
  );
}
