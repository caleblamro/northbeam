'use client';

// AI step config — classify / extract / draft with Claude. The prompt is a
// merge-field textarea; the result lands in a flow variable or an in-memory
// record field. Inert (node fails with 'ai_not_configured') until the org's
// server has ANTHROPIC_API_KEY.

import { Field } from '@/components/northbeam/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FlowAssignTarget, FlowNodeOfType } from '@northbeam/core/flow';
import { useId, useState } from 'react';
import { MergeFieldTextarea } from '../merge-field-input';
import { type FlowPanelMeta, VarNameField, writableFields } from './shared';

type AiStepConfig = FlowNodeOfType<'ai_step'>['config'];

const MODE_HINT: Record<AiStepConfig['mode'], string> = {
  classify: 'Pick exactly one of your options.',
  extract: 'Pull a structured value out of the context.',
  draft: 'Write free-form text (an email body, a summary…).',
};

export function AiStepPanel({
  config,
  onConfig,
  meta,
}: {
  config: AiStepConfig;
  onConfig: (next: AiStepConfig) => void;
  meta: FlowPanelMeta;
}) {
  const modeId = useId();
  const [optionsText, setOptionsText] = useState(
    config.mode === 'classify' ? config.options.join('\n') : '',
  );

  const setOutput = (output: FlowAssignTarget) => onConfig({ ...config, output });

  return (
    <div className="flex flex-col gap-4">
      <Field label="Mode" htmlFor={modeId} description={MODE_HINT[config.mode]}>
        <Select
          value={config.mode}
          onValueChange={(mode) => {
            if (mode === 'classify')
              onConfig({
                mode: 'classify',
                prompt: config.prompt,
                options: optionsText
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
                output: config.output,
              });
            else
              onConfig({
                mode: mode as 'extract' | 'draft',
                prompt: config.prompt,
                output: config.output,
              });
          }}
        >
          <SelectTrigger id={modeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="classify">Classify</SelectItem>
            <SelectItem value="extract">Extract</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Prompt">
        <MergeFieldTextarea
          value={config.prompt}
          onChange={(prompt) => onConfig({ ...config, prompt })}
          paths={meta.mergePaths}
          rows={5}
          aria-label="Prompt"
          placeholder="Classify this deal's risk from {{record.notes}}…"
        />
      </Field>

      {config.mode === 'classify' && (
        <Field label="Options" description="One per line — the model must pick exactly one (2–20).">
          <Textarea
            value={optionsText}
            rows={4}
            spellCheck={false}
            aria-label="Classification options"
            placeholder={'low\nmedium\nhigh'}
            onChange={(e) => {
              setOptionsText(e.target.value);
              onConfig({
                ...config,
                options: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 20),
              });
            }}
          />
        </Field>
      )}

      <Field label="Store result in">
        <Select
          value={config.output.scope}
          onValueChange={(scope) =>
            setOutput(
              scope === 'vars'
                ? { scope: 'vars', name: 'result' }
                : { scope: 'record', fieldKey: meta.fields[0]?.key ?? '' },
            )
          }
        >
          <SelectTrigger aria-label="Output scope" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vars">A flow variable</SelectItem>
            <SelectItem value="record">A record field (in-memory)</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {config.output.scope === 'vars' ? (
        <VarNameField
          label="Variable"
          value={config.output.name}
          onChange={(name) => setOutput({ scope: 'vars', name })}
        />
      ) : (
        <Field label="Field" description="Add an Update records step to persist it.">
          <Select
            value={config.output.fieldKey || undefined}
            onValueChange={(fieldKey) => setOutput({ scope: 'record', fieldKey })}
          >
            <SelectTrigger aria-label="Output field" className="w-full">
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
