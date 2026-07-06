'use client';

// Config forms for the action nodes: update/create/delete records, assign
// owner, send email, post to timeline, notify, outbound webhook. Every
// free-text value is a MergeFieldInput so {{record.*}}/{{vars.*}} insert at
// the caret.

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FlowNodeOfType, FlowNotifyRecipient } from '@northbeam/core/flow';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { MergeFieldInput, MergeFieldTextarea } from '../merge-field-input';
import {
  FieldValuesEditor,
  type FlowPanelMeta,
  MembersSelect,
  ObjectKeySelect,
  RecordTargetEditor,
  UpdateTargetEditor,
  VarNameField,
  useObjectFields,
} from './shared';

/* ── Update records ─────────────────────────────────────────────────────── */

type UpdateRecordsConfig = FlowNodeOfType<'update_records'>['config'];

export function UpdateRecordsPanel({
  config,
  onConfig,
  meta,
}: {
  config: UpdateRecordsConfig;
  onConfig: (next: UpdateRecordsConfig) => void;
  meta: FlowPanelMeta;
}) {
  // Best-effort field list: query targets name their object; the other
  // targets usually hold trigger-object records.
  const targetObjectKey = config.target.kind === 'query' ? config.target.objectKey : meta.objectKey;
  const fields = useObjectFields(targetObjectKey);

  return (
    <div className="flex flex-col gap-4">
      <UpdateTargetEditor
        value={config.target}
        onChange={(target) => onConfig({ ...config, target })}
        meta={meta}
      />
      <Field label="Set fields">
        <FieldValuesEditor
          key={targetObjectKey ?? '_'}
          objectFields={fields}
          value={config.fields}
          onChange={(next) => onConfig({ ...config, fields: next })}
          mergePaths={meta.mergePaths}
        />
      </Field>
    </div>
  );
}

/* ── Create record ──────────────────────────────────────────────────────── */

type CreateRecordConfig = FlowNodeOfType<'create_record'>['config'];

export function CreateRecordPanel({
  config,
  onConfig,
  meta,
}: {
  config: CreateRecordConfig;
  onConfig: (next: CreateRecordConfig) => void;
  meta: FlowPanelMeta;
}) {
  const fields = useObjectFields(config.objectKey || null);
  return (
    <div className="flex flex-col gap-4">
      <ObjectKeySelect
        value={config.objectKey}
        onChange={(objectKey) => onConfig({ ...config, objectKey, fields: {} })}
        objects={meta.objects}
      />
      <Field label="Set fields">
        <FieldValuesEditor
          key={config.objectKey || '_'}
          objectFields={fields}
          value={config.fields}
          onChange={(next) => onConfig({ ...config, fields: next })}
          mergePaths={meta.mergePaths}
        />
      </Field>
      <VarNameField
        label="Store created record in"
        value={config.assignTo ?? ''}
        onChange={(assignTo) =>
          onConfig(assignTo ? { ...config, assignTo } : { ...config, assignTo: undefined })
        }
        description="Optional — read later as {{vars.name.id}} etc."
      />
    </div>
  );
}

/* ── Delete record ──────────────────────────────────────────────────────── */

type DeleteRecordConfig = FlowNodeOfType<'delete_record'>['config'];

export function DeleteRecordPanel({
  config,
  onConfig,
}: {
  config: DeleteRecordConfig;
  onConfig: (next: DeleteRecordConfig) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <RecordTargetEditor value={config.target} onChange={(target) => onConfig({ target })} />
      <p className="text-muted-foreground text-xs">
        Deletes are permanent — there is no recycle bin.
      </p>
    </div>
  );
}

/* ── Assign owner ───────────────────────────────────────────────────────── */

type AssignOwnerConfig = FlowNodeOfType<'assign_owner'>['config'];

export function AssignOwnerPanel({
  config,
  onConfig,
  meta,
}: {
  config: AssignOwnerConfig;
  onConfig: (next: AssignOwnerConfig) => void;
  meta: FlowPanelMeta;
}) {
  const kindId = useId();
  return (
    <div className="flex flex-col gap-4">
      <RecordTargetEditor
        value={config.target}
        onChange={(target) => onConfig({ ...config, target })}
      />
      <Field label="New owner" htmlFor={kindId}>
        <Select
          value={config.owner.kind}
          onValueChange={(kind) =>
            onConfig({
              ...config,
              owner:
                kind === 'user' ? { kind: 'user', userId: '' } : { kind: 'template', value: '' },
            })
          }
        >
          <SelectTrigger id={kindId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">A member</SelectItem>
            <SelectItem value="template">From a merge field</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {config.owner.kind === 'user' ? (
        <MembersSelect
          value={config.owner.userId}
          onChange={(userId) => onConfig({ ...config, owner: { kind: 'user', userId } })}
          members={meta.members}
        />
      ) : (
        <MergeFieldInput
          value={config.owner.value}
          onChange={(value) => onConfig({ ...config, owner: { kind: 'template', value } })}
          paths={meta.mergePaths}
          aria-label="Owner merge field"
          placeholder="{{record.owner_id}}"
        />
      )}
    </div>
  );
}

/* ── Send email ─────────────────────────────────────────────────────────── */

type SendEmailConfig = FlowNodeOfType<'send_email'>['config'];

export function SendEmailPanel({
  config,
  onConfig,
  meta,
}: {
  config: SendEmailConfig;
  onConfig: (next: SendEmailConfig) => void;
  meta: FlowPanelMeta;
}) {
  // Local text keeps in-progress newlines; the config only ever holds the
  // parsed non-empty lines. Host remounts per node id.
  const [toText, setToText] = useState(config.to.join('\n'));
  return (
    <div className="flex flex-col gap-4">
      <Field label="To" description="One address (or merge field) per line, up to 10.">
        <MergeFieldTextarea
          value={toText}
          onChange={(text) => {
            setToText(text);
            onConfig({
              ...config,
              to: text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 10),
            });
          }}
          paths={meta.mergePaths}
          rows={2}
          aria-label="Recipients"
          placeholder={'ada@example.com\n{{record.email}}'}
        />
      </Field>
      <Field label="Subject">
        <MergeFieldInput
          value={config.subject}
          onChange={(subject) => onConfig({ ...config, subject })}
          paths={meta.mergePaths}
          aria-label="Subject"
        />
      </Field>
      <Field label="Body">
        <MergeFieldTextarea
          value={config.body}
          onChange={(body) => onConfig({ ...config, body })}
          paths={meta.mergePaths}
          rows={6}
          aria-label="Body"
        />
      </Field>
    </div>
  );
}

/* ── Post to timeline ───────────────────────────────────────────────────── */

type PostTimelineConfig = FlowNodeOfType<'post_timeline'>['config'];

export function PostTimelinePanel({
  config,
  onConfig,
  meta,
}: {
  config: PostTimelineConfig;
  onConfig: (next: PostTimelineConfig) => void;
  meta: FlowPanelMeta;
}) {
  return (
    <div className="flex flex-col gap-4">
      <RecordTargetEditor
        value={config.target}
        onChange={(target) => onConfig({ ...config, target })}
      />
      <Field label="Note" description="Posted as a system note on the record's timeline.">
        <MergeFieldTextarea
          value={config.body}
          onChange={(body) => onConfig({ ...config, body })}
          paths={meta.mergePaths}
          rows={4}
          aria-label="Note body"
        />
      </Field>
    </div>
  );
}

/* ── Notify ─────────────────────────────────────────────────────────────── */

type NotifyConfig = FlowNodeOfType<'notify'>['config'];

const RECIPIENT_LABEL: Record<FlowNotifyRecipient['kind'], string> = {
  user: 'A member',
  record_owner: 'The record owner',
  template: 'From a merge field',
};

export function NotifyPanel({
  config,
  onConfig,
  meta,
}: {
  config: NotifyConfig;
  onConfig: (next: NotifyConfig) => void;
  meta: FlowPanelMeta;
}) {
  const recipients = config.recipients;
  const patch = (i: number, next: FlowNotifyRecipient) =>
    onConfig({ ...config, recipients: recipients.map((r, idx) => (idx === i ? next : r)) });

  return (
    <div className="flex flex-col gap-4">
      <Field label="Recipients">
        <div className="flex flex-col gap-2">
          {recipients.map((recipient, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; order-only edits
              key={i}
              className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_auto] items-center gap-2"
            >
              <Select
                value={recipient.kind}
                onValueChange={(kind) =>
                  patch(
                    i,
                    kind === 'user'
                      ? { kind: 'user', userId: '' }
                      : kind === 'template'
                        ? { kind: 'template', value: '' }
                        : { kind: 'record_owner' },
                  )
                }
              >
                <SelectTrigger aria-label={`Recipient ${i + 1} kind`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RECIPIENT_LABEL) as FlowNotifyRecipient['kind'][]).map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {RECIPIENT_LABEL[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {recipient.kind === 'user' ? (
                <MembersSelect
                  value={recipient.userId}
                  onChange={(userId) => patch(i, { kind: 'user', userId })}
                  members={meta.members}
                />
              ) : recipient.kind === 'template' ? (
                <MergeFieldInput
                  value={recipient.value}
                  onChange={(value) => patch(i, { kind: 'template', value })}
                  paths={meta.mergePaths}
                  aria-label={`Recipient ${i + 1} merge field`}
                  placeholder="{{record.owner_id}}"
                />
              ) : (
                <span className="text-muted-foreground text-xs">Owner of the trigger record</span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove recipient ${i + 1}`}
                disabled={recipients.length <= 1}
                onClick={() =>
                  onConfig({ ...config, recipients: recipients.filter((_, idx) => idx !== i) })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={recipients.length >= 10}
              onClick={() =>
                onConfig({ ...config, recipients: [...recipients, { kind: 'record_owner' }] })
              }
            >
              <Plus />
              Add recipient
            </Button>
          </div>
        </div>
      </Field>

      <Field label="Title">
        <MergeFieldInput
          value={config.title}
          onChange={(title) => onConfig({ ...config, title })}
          paths={meta.mergePaths}
          aria-label="Notification title"
        />
      </Field>
      <Field label="Body" optional>
        <MergeFieldTextarea
          value={config.body ?? ''}
          onChange={(body) => onConfig(body ? { ...config, body } : { ...config, body: undefined })}
          paths={meta.mergePaths}
          rows={3}
          aria-label="Notification body"
        />
      </Field>
      <Field label="Link" optional description="In-app path or absolute URL.">
        <MergeFieldInput
          value={config.link ?? ''}
          onChange={(link) => onConfig(link ? { ...config, link } : { ...config, link: undefined })}
          paths={meta.mergePaths}
          aria-label="Notification link"
          placeholder="/deals"
        />
      </Field>
    </div>
  );
}

/* ── Outbound webhook ───────────────────────────────────────────────────── */

type WebhookOutConfig = FlowNodeOfType<'webhook_out'>['config'];
type HeaderRow = { key: string; value: string };

const METHODS: WebhookOutConfig['method'][] = ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'];

export function WebhookOutPanel({
  config,
  onConfig,
  meta,
}: {
  config: WebhookOutConfig;
  onConfig: (next: WebhookOutConfig) => void;
  meta: FlowPanelMeta;
}) {
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    Object.entries(config.headers ?? {}).map(([key, value]) => ({ key, value })),
  );
  const commitHeaders = (rows: HeaderRow[]) => {
    setHeaders(rows);
    const record = Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.value]));
    onConfig({
      ...config,
      headers: Object.keys(record).length > 0 ? record : undefined,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[110px_minmax(0,1fr)] items-end gap-2">
        <Field label="Method">
          <Select
            value={config.method}
            onValueChange={(method) =>
              onConfig({ ...config, method: method as WebhookOutConfig['method'] })
            }
          >
            <SelectTrigger aria-label="Method" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="URL" description="HTTPS only — private and internal addresses are blocked.">
          <MergeFieldInput
            value={config.url}
            onChange={(url) => onConfig({ ...config, url })}
            paths={meta.mergePaths}
            aria-label="URL"
            placeholder="https://example.com/hooks/deal"
          />
        </Field>
      </div>

      <Field label="Headers" optional>
        <div className="flex flex-col gap-2">
          {headers.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; order-only edits
            <div key={i} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] gap-2">
              <Input
                value={row.key}
                aria-label={`Header ${i + 1} name`}
                placeholder="X-Header"
                spellCheck={false}
                className="font-mono text-xs"
                onChange={(e) =>
                  commitHeaders(
                    headers.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)),
                  )
                }
              />
              <MergeFieldInput
                value={row.value}
                onChange={(value) =>
                  commitHeaders(headers.map((r, idx) => (idx === i ? { ...r, value } : r)))
                }
                paths={meta.mergePaths}
                aria-label={`Header ${i + 1} value`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove header ${i + 1}`}
                onClick={() => commitHeaders(headers.filter((_, idx) => idx !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={headers.length >= 10}
              onClick={() => commitHeaders([...headers, { key: '', value: '' }])}
            >
              <Plus />
              Add header
            </Button>
          </div>
        </div>
      </Field>

      <Field label="Body" optional>
        <MergeFieldTextarea
          value={config.body ?? ''}
          onChange={(body) => onConfig(body ? { ...config, body } : { ...config, body: undefined })}
          paths={meta.mergePaths}
          rows={5}
          aria-label="Request body"
          placeholder='{"dealId": "{{record.id}}"}'
        />
      </Field>
    </div>
  );
}
