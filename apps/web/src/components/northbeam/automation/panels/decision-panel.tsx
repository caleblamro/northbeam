'use client';

// Decision node config — ordered outcome cards (label + condition), evaluated
// first-truthy at run time. Outcome add/remove/reorder run through the editor
// reducer (they also touch edges); label/condition edits replace the config.

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { FlowNodeOfType } from '@northbeam/core/flow';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { ConditionEditor } from './condition-editor';
import type { FlowPanelMeta } from './shared';

type DecisionConfig = FlowNodeOfType<'decision'>['config'];
type Outcome = DecisionConfig['outcomes'][number];

export function DecisionPanel({
  config,
  onConfig,
  meta,
  onAddOutcome,
  onRemoveOutcome,
  onMoveOutcome,
}: {
  config: DecisionConfig;
  onConfig: (next: DecisionConfig) => void;
  meta: FlowPanelMeta;
  onAddOutcome: () => void;
  onRemoveOutcome: (outcomeId: string) => void;
  onMoveOutcome: (outcomeId: string, direction: 'up' | 'down') => void;
}) {
  const patchOutcome = (id: string, patch: Partial<Outcome>) =>
    onConfig({
      outcomes: config.outcomes.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        Outcomes are checked in order — the first match wins. Records matching none take the dashed{' '}
        <span className="font-medium">Default</span> path.
      </p>

      {config.outcomes.map((outcome, i) => (
        <div key={outcome.id} className="flex flex-col gap-3 rounded-md border bg-card p-3">
          <div className="flex items-end gap-1.5">
            <Field label={`Outcome ${i + 1}`} className="flex-1" htmlFor={`outcome-${outcome.id}`}>
              <Input
                id={`outcome-${outcome.id}`}
                value={outcome.label}
                maxLength={60}
                onChange={(e) => patchOutcome(outcome.id, { label: e.target.value })}
              />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move outcome ${i + 1} up`}
              disabled={i === 0}
              onClick={() => onMoveOutcome(outcome.id, 'up')}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Move outcome ${i + 1} down`}
              disabled={i === config.outcomes.length - 1}
              onClick={() => onMoveOutcome(outcome.id, 'down')}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove outcome ${i + 1}`}
              disabled={config.outcomes.length <= 1}
              onClick={() => onRemoveOutcome(outcome.id)}
            >
              <Trash2 className="text-destructive" />
            </Button>
          </div>
          <ConditionEditor
            value={outcome.condition}
            onChange={(condition) => patchOutcome(outcome.id, { condition })}
            fields={meta.fields}
          />
        </div>
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={config.outcomes.length >= 10}
          onClick={onAddOutcome}
        >
          <Plus />
          Add outcome
        </Button>
      </div>
    </div>
  );
}
