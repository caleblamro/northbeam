'use client';

// Config forms for the three trigger node types. Record triggers edit event
// + watched fields + entry condition; scheduled triggers edit the schedule
// union + timezone; webhook triggers surface the signed endpoint (URL +
// secret + rotate) — the secret lives on the flow row, not in the graph.

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/api';
import type { FlowNodeOfType, FlowSchedule } from '@northbeam/core/flow';
import { Check, Copy, RefreshCw, X } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { OptionalConditionEditor } from './condition-editor';
import type { FlowPanelMeta } from './shared';

/* ── Record trigger ─────────────────────────────────────────────────────── */

type RecordTriggerConfig = FlowNodeOfType<'trigger_record'>['config'];

const EVENT_LABEL: Record<RecordTriggerConfig['event'], string> = {
  created: 'Created',
  updated: 'Updated',
  created_or_updated: 'Created or updated',
  deleted: 'Deleted',
};

export function RecordTriggerPanel({
  config,
  onConfig,
  meta,
}: {
  config: RecordTriggerConfig;
  onConfig: (next: RecordTriggerConfig) => void;
  meta: FlowPanelMeta;
}) {
  const eventId = useId();
  const watchId = useId();
  const watchesUpdates = config.event === 'updated' || config.event === 'created_or_updated';
  const watched = config.watchedFieldKeys ?? [];
  const addable = meta.fields.filter((f) => !watched.includes(f.key));

  return (
    <div className="flex flex-col gap-4">
      {!meta.objectKey && (
        <Callout variant="warning">Attach this flow to an object to use a record trigger.</Callout>
      )}
      <Field label="Run when a record is" htmlFor={eventId}>
        <Select
          value={config.event}
          onValueChange={(event) => onConfig({ ...config, event: event as typeof config.event })}
        >
          <SelectTrigger id={eventId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EVENT_LABEL) as Array<typeof config.event>).map((event) => (
              <SelectItem key={event} value={event}>
                {EVENT_LABEL[event]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {watchesUpdates && (
        <Field
          label="Watched fields"
          htmlFor={watchId}
          description="Updates fire only when one of these fields changed. Empty = any change."
        >
          <div className="flex flex-col gap-2">
            {watched.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {watched.map((key) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs"
                  >
                    {meta.fields.find((f) => f.key === key)?.label ?? key}
                    <button
                      type="button"
                      aria-label={`Stop watching ${key}`}
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        onConfig({
                          ...config,
                          watchedFieldKeys: watched.filter((k) => k !== key),
                        })
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <Select
              value=""
              onValueChange={(key) => onConfig({ ...config, watchedFieldKeys: [...watched, key] })}
              disabled={addable.length === 0 || watched.length >= 20}
            >
              <SelectTrigger id={watchId} className="w-full">
                <SelectValue placeholder="Watch a field…" />
              </SelectTrigger>
              <SelectContent>
                {addable.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Field>
      )}

      <OptionalConditionEditor
        label="Entry condition"
        value={config.entryCondition}
        fields={meta.fields}
        onChange={(entryCondition) =>
          onConfig(
            entryCondition
              ? { ...config, entryCondition }
              : { ...config, entryCondition: undefined },
          )
        }
      />
    </div>
  );
}

/* ── Scheduled trigger ──────────────────────────────────────────────────── */

type ScheduledTriggerConfig = FlowNodeOfType<'trigger_scheduled'>['config'];

function defaultScheduleFor(frequency: FlowSchedule['frequency']): FlowSchedule {
  switch (frequency) {
    case 'once':
      return { frequency: 'once', at: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    case 'daily':
      return { frequency: 'daily', time: '09:00' };
    case 'weekly':
      return { frequency: 'weekly', weekday: 1, time: '09:00' };
    case 'cron':
      return { frequency: 'cron', expression: '0 9 * * 1' };
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** datetime-local ↔ ISO-with-offset (the schema requires an explicit offset;
 *  toISOString's Z qualifies). Render in the browser's local time. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduledTriggerPanel({
  config,
  onConfig,
  meta,
}: {
  config: ScheduledTriggerConfig;
  onConfig: (next: ScheduledTriggerConfig) => void;
  meta: FlowPanelMeta;
}) {
  const freqId = useId();
  const tzId = useId();
  const schedule = config.schedule;

  const setSchedule = (next: FlowSchedule) => onConfig({ ...config, schedule: next });

  return (
    <div className="flex flex-col gap-4">
      <Field label="Frequency" htmlFor={freqId}>
        <Select
          value={schedule.frequency}
          onValueChange={(f) => setSchedule(defaultScheduleFor(f as FlowSchedule['frequency']))}
        >
          <SelectTrigger id={freqId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="once">Once</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="cron">Cron expression</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {schedule.frequency === 'once' && (
        <Field label="Run at">
          <Input
            type="datetime-local"
            aria-label="Run at"
            value={toLocalInput(schedule.at)}
            onChange={(e) => {
              const date = new Date(e.target.value);
              if (!Number.isNaN(date.getTime()))
                setSchedule({ frequency: 'once', at: date.toISOString() });
            }}
          />
        </Field>
      )}
      {schedule.frequency === 'daily' && (
        <Field label="Time">
          <Input
            type="time"
            aria-label="Time"
            value={schedule.time}
            onChange={(e) => setSchedule({ frequency: 'daily', time: e.target.value })}
          />
        </Field>
      )}
      {schedule.frequency === 'weekly' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Weekday">
            <Select
              value={String(schedule.weekday)}
              onValueChange={(w) => setSchedule({ ...schedule, weekday: Number(w) })}
            >
              <SelectTrigger aria-label="Weekday" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((day, i) => (
                  <SelectItem key={day} value={String(i)}>
                    {day}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Time">
            <Input
              type="time"
              aria-label="Time"
              value={schedule.time}
              onChange={(e) => setSchedule({ ...schedule, time: e.target.value })}
            />
          </Field>
        </div>
      )}
      {schedule.frequency === 'cron' && (
        <Field label="Expression" description="Five fields: minute hour day month weekday.">
          <Input
            aria-label="Cron expression"
            value={schedule.expression}
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(e) => setSchedule({ frequency: 'cron', expression: e.target.value })}
          />
        </Field>
      )}

      <Field label="Timezone" htmlFor={tzId} description="IANA zone, e.g. America/Chicago.">
        <Input
          id={tzId}
          value={config.timezone}
          spellCheck={false}
          onChange={(e) => onConfig({ ...config, timezone: e.target.value })}
        />
      </Field>

      {meta.objectKey ? (
        <OptionalConditionEditor
          label="Only for records matching"
          value={config.entryCondition}
          fields={meta.fields}
          onChange={(entryCondition) =>
            onConfig(
              entryCondition
                ? { ...config, entryCondition }
                : { ...config, entryCondition: undefined },
            )
          }
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          Global schedule — fires one run per tick. Attach the flow to an object to fan out one run
          per matching record.
        </p>
      )}
    </div>
  );
}

/* ── Webhook trigger ────────────────────────────────────────────────────── */

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="text-[var(--success)]" /> : <Copy />}
    </Button>
  );
}

export function WebhookTriggerPanel({ meta }: { meta: FlowPanelMeta }) {
  const utils = trpc.useUtils();
  const rotate = trpc.automation.rotateWebhookSecret.useMutation({
    meta: { context: "Couldn't rotate the webhook secret" },
    onSuccess: () => {
      utils.automation.get.invalidate({ id: meta.flowId });
      toast.success('Webhook secret rotated');
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Endpoint"
        description="POST JSON (≤256 KB). Runs only while the flow is active."
      >
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-xs">
            {meta.webhookUrl ?? '…'}
          </code>
          {meta.webhookUrl && <CopyButton value={meta.webhookUrl} label="Copy endpoint URL" />}
        </div>
      </Field>

      <Field
        label="Signing secret"
        description="Send X-Northbeam-Signature: hex(HMAC-SHA256(secret, raw body))."
      >
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-xs">
            {meta.webhookSecret ? `${meta.webhookSecret.slice(0, 8)}…` : '…'}
          </code>
          {meta.webhookSecret && <CopyButton value={meta.webhookSecret} label="Copy secret" />}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rotate.isPending}
            onClick={() => rotate.mutate({ id: meta.flowId })}
          >
            <RefreshCw className={rotate.isPending ? 'animate-spin' : undefined} />
            Rotate
          </Button>
        </div>
      </Field>

      <p className="text-muted-foreground text-xs">
        The request body is available to steps as{' '}
        <code className="font-mono">{'{{webhook.*}}'}</code>.
      </p>
    </div>
  );
}
