'use client';

// Test-run panel — pick a sample record (record.searchRefs combobox) or a
// simulated webhook payload, run the DRAFT graph server-side (real reads,
// simulated side effects, waits short-circuit), then trace the result: the
// step timeline here + the taken-path overlay on the canvas.

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import type { FlowGraph } from '@northbeam/core/flow';
import { AlertCircle, CheckCircle2, ChevronsUpDown, FlaskConical, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { type FlowStep, FlowStepTimeline } from '../run-history';
import type { FlowTraceStepLike } from '../run-overlay';
import type { FlowPanelMeta } from './shared';

type TestResult = {
  status: 'completed' | 'failed';
  steps: FlowStep[];
  error?: string;
  endedReason?: string;
  vars: Record<string, unknown>;
};

function SampleRecordPicker({
  objectKey,
  value,
  onChange,
}: {
  objectKey: string;
  value: { id: string; label: string } | null;
  onChange: (next: { id: string; label: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const search = trpc.record.searchRefs.useQuery(
    { objectKey, q, limit: 20 },
    { enabled: open, placeholderData: (prev) => prev },
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal">
          <span className="truncate">{value?.label ?? 'Choose a sample record…'}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search records…" value={q} onValueChange={setQ} autoFocus />
          <CommandList>
            <CommandEmpty>No matching records.</CommandEmpty>
            <CommandGroup>
              {(search.data ?? []).map((row) => (
                <CommandItem
                  key={row.value}
                  value={row.value}
                  onSelect={() => {
                    onChange({ id: row.value, label: row.label });
                    setOpen(false);
                  }}
                >
                  {row.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function TestRunPanel({
  meta,
  graph,
  onTrace,
  onFocusNode,
  onEnsureSaved,
  onClose,
}: {
  meta: FlowPanelMeta;
  graph: FlowGraph;
  /** Publish the trace for the canvas overlay (null clears it). */
  onTrace: (steps: FlowTraceStepLike[] | null) => void;
  onFocusNode?: (nodeId: string) => void;
  /** Persist a dirty draft first — the server tests the SAVED draft. */
  onEnsureSaved: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<{ id: string; label: string } | null>(null);
  const [webhookText, setWebhookText] = useState('{}');
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const testRun = trpc.automation.testRun.useMutation({
    meta: { context: "Couldn't run the test" },
  });

  const isWebhook = meta.trigger?.type === 'trigger_webhook';

  const run = async () => {
    let webhookBody: unknown;
    if (isWebhook) {
      try {
        webhookBody = JSON.parse(webhookText || '{}');
        setWebhookError(null);
      } catch {
        setWebhookError('Not valid JSON.');
        return;
      }
    }
    if (!(await onEnsureSaved())) return;
    const res = await testRun.mutateAsync({
      id: meta.flowId,
      ...(record ? { recordId: record.id } : {}),
      ...(isWebhook ? { webhookBody } : {}),
    });
    setResult(res as TestResult);
    onTrace(res.steps);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <FlaskConical className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">Test run</div>
          <div className="truncate text-muted-foreground text-xs">
            Reads are real, writes are simulated, waits skip ahead.
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close test panel" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {meta.objectKey && (
          <Field
            label="Sample record"
            description="Seeds {{record.*}} (and {{oldRecord.*}} with the same values)."
          >
            <SampleRecordPicker objectKey={meta.objectKey} value={record} onChange={setRecord} />
          </Field>
        )}

        {isWebhook && (
          <Field label="Webhook payload" error={webhookError ?? undefined}>
            <Textarea
              value={webhookText}
              rows={5}
              spellCheck={false}
              className="font-mono text-xs"
              aria-label="Webhook payload"
              onChange={(e) => setWebhookText(e.target.value)}
            />
          </Field>
        )}

        <div>
          <Button type="button" disabled={testRun.isPending} onClick={run}>
            {testRun.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
            Run test
          </Button>
        </div>

        {result && (
          <>
            {result.status === 'completed' ? (
              <Callout variant="success" icon={CheckCircle2}>
                Completed{result.endedReason ? ` — ${result.endedReason}` : ''}
              </Callout>
            ) : (
              <Callout variant="danger" icon={AlertCircle}>
                {result.error ?? 'The run failed.'}
              </Callout>
            )}

            <FlowStepTimeline steps={result.steps} graph={graph} onFocusNode={onFocusNode} />

            {Object.keys(result.vars).length > 0 && (
              <Field label="Final variables">
                <pre className="max-h-48 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs">
                  {JSON.stringify(result.vars, null, 2)}
                </pre>
              </Field>
            )}
          </>
        )}
      </div>
    </div>
  );
}
