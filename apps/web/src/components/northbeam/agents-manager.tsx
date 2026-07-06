'use client';

// AgentsManager — Setup → AI agents. List + create/edit dialog for agent
// presets: name, system prompt, allowed models (AVAILABLE_AI_MODELS), tool
// allowlist (AI_TOOLS catalog; null = everything the caller's role policy
// already grants), and role visibility (null = everyone). System agents are
// editable but not deletable; keys are immutable after create.

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Field } from '@/components/northbeam/field';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { type RouterOutputs, trpc } from '@/lib/api';
import { AVAILABLE_AI_MODELS } from '@northbeam/core/ai-tools';
import { AI_TOOLS } from '@northbeam/core/ai-tools';
import { Bot, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

type AgentRow = RouterOutputs['agent']['list'][number];

type Draft = {
  key: string;
  keyTouched: boolean;
  name: string;
  description: string;
  systemPrompt: string;
  models: string[];
  /** null = all tools the user's role policy grants. */
  toolIds: string[] | null;
  /** null = visible to every role. */
  roleKeys: string[] | null;
};

const EMPTY_DRAFT: Draft = {
  key: '',
  keyTouched: false,
  name: '',
  description: '',
  systemPrompt: '',
  models: [],
  toolIds: null,
  roleKeys: null,
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function draftFrom(agent: AgentRow): Draft {
  return {
    key: agent.key,
    keyTouched: true,
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    models: [...agent.models],
    toolIds: agent.toolIds ? [...agent.toolIds] : null,
    roleKeys: agent.roleKeys ? [...agent.roleKeys] : null,
  };
}

export function AgentsManager() {
  const utils = trpc.useUtils();
  const agents = trpc.agent.list.useQuery();
  const roles = trpc.role.list.useQuery();

  const [editing, setEditing] = useState<AgentRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AgentRow | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const invalidate = () => utils.agent.list.invalidate();
  const create = trpc.agent.create.useMutation({
    meta: { context: "Couldn't create the agent" },
    onSuccess: invalidate,
  });
  const update = trpc.agent.update.useMutation({
    meta: { context: "Couldn't update the agent" },
    onSuccess: invalidate,
  });
  const remove = trpc.agent.delete.useMutation({
    meta: { context: "Couldn't delete the agent" },
    onSuccess: invalidate,
  });

  const dialogOpen = creating || editing !== null;
  const closeDialog = () => {
    setCreating(false);
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  };

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setCreating(true);
  };
  const openEdit = (agent: AgentRow) => {
    setDraft(draftFrom(agent));
    setEditing(agent);
  };

  const canSubmit = draft.name.trim().length > 0 && (editing || slugify(draft.key).length > 0);
  const submit = async () => {
    const fields = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      systemPrompt: draft.systemPrompt,
      models: draft.models,
      toolIds: draft.toolIds,
      roleKeys: draft.roleKeys,
    };
    if (editing) {
      await update.mutateAsync({ id: editing.id, ...fields });
    } else {
      await create.mutateAsync({ key: slugify(draft.key), ...fields });
    }
    closeDialog();
  };

  return (
    <SectionCard
      icon={Bot}
      title="AI agents"
      action={
        <Button size="sm" onClick={openCreate}>
          <Plus />
          New agent
        </Button>
      }
    >
      {agents.isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (agents.data ?? []).length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents"
          body="Create a preset with its own prompt, models, and tool allowlist."
          size="sm"
        />
      ) : (
        <ul className="flex flex-col">
          {(agents.data ?? []).map((a) => (
            <AgentRowItem
              key={a.id}
              agent={a}
              roleNames={roles.data ?? []}
              onEdit={() => openEdit(a)}
              onDelete={a.isSystem ? undefined : () => setDeleting(a)}
            />
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New agent'}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field label="Name" required htmlFor="agent-name">
              <Input
                id="agent-name"
                value={draft.name}
                autoFocus
                placeholder="Pipeline analyst"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    name: e.target.value,
                    key: !editing && !d.keyTouched ? slugify(e.target.value) : d.key,
                  }))
                }
              />
            </Field>
            {!editing && (
              <Field label="Key" required htmlFor="agent-key" description="Immutable after create.">
                <Input
                  id="agent-key"
                  value={draft.key}
                  placeholder="pipeline-analyst"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, key: slugify(e.target.value), keyTouched: true }))
                  }
                />
              </Field>
            )}
            <Field label="Description" htmlFor="agent-description">
              <Input
                id="agent-description"
                value={draft.description}
                placeholder="What this agent is for — shows on its card."
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <Field
              label="System prompt"
              htmlFor="agent-prompt"
              description="Prepended to the built-in harness prompt each turn."
            >
              <Textarea
                id="agent-prompt"
                value={draft.systemPrompt}
                rows={5}
                placeholder="You specialize in pipeline health. Prefer stage-by-stage breakdowns…"
                onChange={(e) => setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
              />
            </Field>
            <Field label="Models" description="None selected = the workspace default model.">
              <div className="flex flex-col gap-1.5 rounded-md border p-2.5">
                {AVAILABLE_AI_MODELS.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={draft.models.includes(m.id)}
                      onCheckedChange={(on) =>
                        setDraft((d) => ({
                          ...d,
                          models: on ? [...d.models, m.id] : d.models.filter((id) => id !== m.id),
                        }))
                      }
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </Field>
            <ScopedListField
              label="Tools"
              allLabel="Everything the user's role already allows"
              limited={draft.toolIds !== null}
              onToggle={(limited) => setDraft((d) => ({ ...d, toolIds: limited ? [] : null }))}
              options={AI_TOOLS.map((t) => ({ id: t.id, label: t.title }))}
              selected={draft.toolIds ?? []}
              onChange={(toolIds) => setDraft((d) => ({ ...d, toolIds }))}
              description="An allowlist only narrows — it never grants a tool the role policy denies."
            />
            <ScopedListField
              label="Visible to roles"
              allLabel="Every role"
              limited={draft.roleKeys !== null}
              onToggle={(limited) => setDraft((d) => ({ ...d, roleKeys: limited ? [] : null }))}
              options={(roles.data ?? []).map((r) => ({ id: r.key, label: r.name }))}
              selected={draft.roleKeys ?? []}
              onChange={(roleKeys) => setDraft((d) => ({ ...d, roleKeys }))}
              description="Owners always see every agent."
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!canSubmit || create.isPending || update.isPending}
              onClick={submit}
            >
              {(create.isPending || update.isPending) && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {editing ? 'Save changes' : 'Create agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="Existing chats keep their history but can no longer run as this agent."
        confirmLabel="Delete"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) {
            remove.mutate({ id: deleting.id }, { onSettled: () => setDeleting(null) });
          }
        }}
      />
    </SectionCard>
  );
}

/* ── One agent row ──────────────────────────────────────────────────────── */

function AgentRowItem({
  agent,
  roleNames,
  onEdit,
  onDelete,
}: {
  agent: AgentRow;
  roleNames: { key: string; name: string }[];
  onEdit: () => void;
  /** Absent for system agents — they can't be deleted. */
  onDelete?: () => void;
}) {
  const modelSummary =
    agent.models.length === 0
      ? 'Default model'
      : agent.models
          .map((id) => AVAILABLE_AI_MODELS.find((m) => m.id === id)?.label ?? id)
          .join(', ');
  const toolSummary =
    agent.toolIds === null
      ? 'All allowed tools'
      : `${agent.toolIds.length} tool${agent.toolIds.length === 1 ? '' : 's'}`;
  const roleSummary =
    agent.roleKeys === null
      ? 'Everyone'
      : agent.roleKeys.map((k) => roleNames.find((r) => r.key === k)?.name ?? k).join(', ') ||
        'No roles';

  return (
    <li className="group flex items-center gap-3 border-border/60 border-b py-3 last:border-b-0">
      <div className="grid size-8 shrink-0 place-items-center rounded-md border bg-card">
        <Bot className="size-4 text-link" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-sm">{agent.name}</span>
          {agent.isSystem && <Badge variant="outline">System</Badge>}
        </span>
        <span className="block truncate text-muted-foreground text-xs">
          {modelSummary} · {toolSummary} · {roleSummary}
        </span>
      </div>
      <span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="icon-xs" aria-label={`Edit ${agent.name}`} onClick={onEdit}>
          <Pencil />
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete ${agent.name}`}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        )}
      </span>
    </li>
  );
}

/* ── Null-or-subset picker: "all" switch + checkbox list ────────────────── */

function ScopedListField({
  label,
  allLabel,
  limited,
  onToggle,
  options,
  selected,
  onChange,
  description,
}: {
  label: string;
  allLabel: string;
  limited: boolean;
  onToggle: (limited: boolean) => void;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  description?: string;
}) {
  return (
    <Field label={label} description={description}>
      <div className="flex flex-col gap-2 rounded-md border p-2.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{allLabel}</span>
          <Switch
            checked={!limited}
            aria-label={allLabel}
            onCheckedChange={(all) => onToggle(!all)}
          />
        </div>
        {limited && (
          <div className="flex flex-col gap-1.5 border-t pt-2">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(o.id)}
                  onCheckedChange={(on) =>
                    onChange(on ? [...selected, o.id] : selected.filter((id) => id !== o.id))
                  }
                />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
