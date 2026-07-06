'use client';

// Directus-style roles & permissions editor. Left rail lists the org's roles
// (system + custom); the right pane edits the selected role: workspace
// (org-level) permission toggles and a per-object create/read/update/delete
// grid. One "Save changes" commits identity + org perms + default grant via
// role.update and each changed object row via role.setObjectPermission.

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { CreateRoleDialog } from '@/components/northbeam/create-role-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import { RoleObjectCriteria } from '@/components/northbeam/role-object-criteria';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type RouterOutputs, trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  type CrudGrant,
  OBJECT_ACTIONS,
  ORG_PERMISSION_KEYS,
  type ObjectAction,
  PERMISSION_GROUPS,
} from '@northbeam/core/roles';
import type { Filter } from '@northbeam/db/views';
import { Loader2, Lock, Plus, RotateCcw, ShieldHalf, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ObjChip } from './app-bits';

type RoleListItem = RouterOutputs['role']['list'][number];

const ORG_KEY_SET = new Set<string>(ORG_PERMISSION_KEYS);
// PERMISSION_GROUPS restricted to org-level (non-record) permissions — record
// access is the CRUD grid, not a toggle.
const ORG_GROUPS = PERMISSION_GROUPS.map((g) => ({
  ...g,
  permissions: g.permissions.filter((p) => ORG_KEY_SET.has(p.key)),
})).filter((g) => g.permissions.length > 0);

const ACTION_LABEL: Record<ObjectAction, string> = {
  create: 'Create',
  read: 'Read',
  update: 'Update',
  delete: 'Delete',
};

export function RolesManager() {
  const rolesQ = trpc.role.list.useQuery();
  const roles = rolesQ.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Default the selection to the highest-ranked role (owner) once loaded.
  useEffect(() => {
    if (!selectedId && roles.length > 0) setSelectedId(roles[0]?.id ?? null);
  }, [roles, selectedId]);

  if (rolesQ.isLoading) {
    return <div className="h-[70vh] animate-pulse rounded-xl border bg-card/40" />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
            Roles
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">{roles.length}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {roles.map((r) => (
            <RoleRailItem
              key={r.id}
              role={r}
              active={r.id === selectedId}
              onSelect={() => setSelectedId(r.id)}
            />
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-1 justify-start"
          onClick={() => setCreateOpen(true)}
        >
          <Plus />
          New role
        </Button>
      </aside>

      <div className="min-w-0">
        {selectedId ? (
          <RoleEditor key={selectedId} roleId={selectedId} onDeleted={() => setSelectedId(null)} />
        ) : (
          <EmptyState
            icon={ShieldHalf}
            title="Select a role"
            body="Pick a role to edit its permissions."
          />
        )}
      </div>

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        copyOptions={roles.map((r) => ({ id: r.id, name: r.name }))}
        onCreated={setSelectedId}
      />
    </div>
  );
}

function RoleRailItem({
  role,
  active,
  onSelect,
}: {
  role: RoleListItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active ? 'true' : undefined}
      className="group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted data-[active=true]:bg-muted"
    >
      <span
        className="size-2.5 shrink-0 rounded-full ring-1 ring-black/5"
        style={{ background: role.color ?? 'var(--brand)' }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground text-sm">{role.name}</span>
          {role.isSystem && <Lock className="size-3 shrink-0 text-muted-foreground/60" />}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {role.memberCount} {role.memberCount === 1 ? 'member' : 'members'}
        </span>
      </span>
    </button>
  );
}

function RoleEditor({ roleId, onDeleted }: { roleId: string; onDeleted: () => void }) {
  const utils = trpc.useUtils();
  const detailQ = trpc.role.get.useQuery({ id: roleId });
  const detail = detailQ.data;

  const isOwner = detail?.role.key === 'owner';
  const locked = isOwner; // Owner has full, immutable access.

  // ── Local edit state, seeded from the server on load / role switch ──────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [orgPerms, setOrgPerms] = useState<Set<string>>(new Set());
  const [defaultGrant, setDefaultGrant] = useState<CrudGrant>({
    create: false,
    read: true,
    update: false,
    delete: false,
  });
  // objectId → { grant, overridden, filter }. Non-overridden rows follow
  // defaultGrant; `filter` is the optional row-level (criteria) scope.
  type ObjState = { grant: CrudGrant; overridden: boolean; filter: Filter[] };
  const [objects, setObjects] = useState<Map<string, ObjState>>(new Map());
  const [snapshot, setSnapshot] = useState('');

  // Seed local state whenever the fetched role changes.
  useEffect(() => {
    if (!detail) return;
    setName(detail.role.name);
    setDescription(detail.role.description);
    setOrgPerms(new Set(detail.role.orgPermissions));
    setDefaultGrant(detail.role.defaultGrant);
    const map = new Map<string, ObjState>();
    for (const o of detail.objects) {
      map.set(o.id, {
        grant: o.grant,
        overridden: o.overridden,
        filter: (o.filter ?? []) as Filter[],
      });
    }
    setObjects(map);
    setSnapshot(
      JSON.stringify({
        name: detail.role.name,
        description: detail.role.description,
        orgPermissions: [...detail.role.orgPermissions].sort(),
        defaultGrant: detail.role.defaultGrant,
        objects: detail.objects.map((o) => ({
          id: o.id,
          grant: o.grant,
          overridden: o.overridden,
          filter: o.filter ?? [],
        })),
      }),
    );
  }, [detail]);

  const current = useMemo(
    () =>
      JSON.stringify({
        name,
        description,
        orgPermissions: [...orgPerms].sort(),
        defaultGrant,
        objects: [...objects.entries()].map(([id, v]) => ({
          id,
          grant: v.grant,
          overridden: v.overridden,
          filter: v.filter,
        })),
      }),
    [name, description, orgPerms, defaultGrant, objects],
  );
  const dirty = snapshot !== '' && current !== snapshot;

  const updateRole = trpc.role.update.useMutation();
  const setObjPerm = trpc.role.setObjectPermission.useMutation();
  const deleteRole = trpc.role.delete.useMutation();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (detailQ.isLoading || !detail) {
    return <div className="h-[70vh] animate-pulse rounded-xl border bg-card/40" />;
  }

  const toggleObjectCell = (objectId: string, action: ObjectAction, checked: boolean) => {
    setObjects((prev) => {
      const next = new Map(prev);
      const cur = next.get(objectId);
      const base = cur?.overridden ? cur.grant : defaultGrant;
      next.set(objectId, {
        grant: { ...base, [action]: checked },
        overridden: true,
        filter: cur?.filter ?? [],
      });
      return next;
    });
  };
  const setObjectFilter = (objectId: string, filter: Filter[]) => {
    setObjects((prev) => {
      const next = new Map(prev);
      const cur = next.get(objectId);
      // A criteria implies an explicit override (it only lives on override rows).
      next.set(objectId, {
        grant: cur?.overridden ? cur.grant : defaultGrant,
        overridden: cur?.overridden || filter.length > 0,
        filter,
      });
      return next;
    });
  };
  const resetObject = (objectId: string) => {
    setObjects((prev) => {
      const next = new Map(prev);
      next.set(objectId, { grant: defaultGrant, overridden: false, filter: [] });
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const initial = JSON.parse(snapshot) as {
        objects: { id: string; grant: CrudGrant; overridden: boolean; filter: Filter[] }[];
      };
      const initialById = new Map(initial.objects.map((o) => [o.id, o]));

      await updateRole.mutateAsync({
        id: roleId,
        name,
        description,
        orgPermissions: [...orgPerms],
        defaultGrant,
      });

      for (const [id, v] of objects) {
        const before = initialById.get(id);
        const changed =
          !before ||
          before.overridden !== v.overridden ||
          JSON.stringify(before.grant) !== JSON.stringify(v.grant) ||
          JSON.stringify(before.filter ?? []) !== JSON.stringify(v.filter);
        if (!changed) continue;
        await setObjPerm.mutateAsync({
          roleId,
          objectId: id,
          grant: v.overridden ? v.grant : null,
          filter: v.overridden && v.filter.length > 0 ? v.filter : null,
        });
      }

      await Promise.all([
        utils.role.get.invalidate({ id: roleId }),
        utils.role.list.invalidate(),
        utils.me.bootstrap.invalidate(),
      ]);
      toast.success('Permissions saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save permissions");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header + sticky save */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-1 size-3.5 shrink-0 rounded-full ring-1 ring-black/5"
            style={{ background: detail.role.color ?? 'var(--brand)' }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-[1.05rem] text-foreground tracking-[-0.01em]">
                {detail.role.name}
              </h2>
              <Badge tone={detail.role.isSystem ? 'neutral' : 'brand'} size="sm">
                {detail.role.isSystem ? 'System' : 'Custom'}
              </Badge>
            </div>
            <code className="text-[11px] text-muted-foreground">{detail.role.key}</code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!detail.role.isSystem && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Delete
            </Button>
          )}
          {!locked && (
            <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
              {saving && <Loader2 className="animate-spin" />}
              Save changes
            </Button>
          )}
        </div>
      </div>

      {locked && (
        <div className="rounded-lg border border-border border-dashed bg-muted/30 px-4 py-3 text-muted-foreground text-sm">
          The <span className="font-medium text-foreground">Owner</span> role has full, immutable
          access to everything in the workspace.
        </div>
      )}

      {/* Identity */}
      {!locked && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 font-medium text-foreground text-sm">Details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label htmlFor="role-name-input" className="flex flex-col gap-1.5">
              <span className="font-medium text-muted-foreground text-xs">Name</span>
              <Input
                id="role-name-input"
                value={name}
                disabled={detail.role.isSystem}
                onChange={(e) => setName(e.target.value)}
              />
              {detail.role.isSystem && (
                <span className="text-[11px] text-muted-foreground">
                  System roles can't be renamed.
                </span>
              )}
            </label>
            <label htmlFor="role-desc-input" className="flex flex-col gap-1.5">
              <span className="font-medium text-muted-foreground text-xs">Description</span>
              <Textarea
                id="role-desc-input"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
          </div>
        </section>
      )}

      {/* Workspace permissions */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-border border-b px-5 py-3.5">
          <h3 className="font-medium text-foreground text-sm">Workspace permissions</h3>
          <p className="text-muted-foreground text-xs">
            What this role can do across the workspace — outside of record data.
          </p>
        </div>
        <div className="divide-y divide-border">
          {ORG_GROUPS.map((group) => (
            <div key={group.id} className="px-5 py-3.5">
              <div className="mb-2.5 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
              <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {group.permissions.map((p) => {
                  const on = isOwner || orgPerms.has(p.key);
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-foreground text-sm">
                          {p.label}
                        </span>
                        {p.description && (
                          <span className="truncate text-muted-foreground text-xs">
                            {p.description}
                          </span>
                        )}
                      </span>
                      <Switch
                        checked={on}
                        disabled={locked}
                        aria-label={p.label}
                        onCheckedChange={(v) =>
                          setOrgPerms((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(p.key);
                            else next.delete(p.key);
                            return next;
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Object permissions grid */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-border border-b px-5 py-3.5">
          <div>
            <h3 className="font-medium text-foreground text-sm">Object permissions</h3>
            <p className="text-muted-foreground text-xs">
              Create, read, update, and delete access per object.
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b bg-muted/40">
                <th className="px-5 py-2.5 text-left font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
                  Object
                </th>
                {OBJECT_ACTIONS.map((a) => (
                  <th
                    key={a}
                    className="w-20 px-2 py-2.5 text-center font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider"
                  >
                    {ACTION_LABEL[a]}
                  </th>
                ))}
                <th className="w-16 px-2 py-2.5 text-center font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
                  Records
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {/* Default row — applies to any object without an explicit override. */}
              <tr className="border-border border-b bg-[var(--accent-soft)]/40">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-sm">All objects</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge tone="neutral" size="sm">
                          default
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        Applied to every object unless overridden in a row below.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </td>
                {OBJECT_ACTIONS.map((a) => (
                  <td key={a} className="px-2 py-3 text-center">
                    <div className="flex justify-center">
                      <Checkbox
                        checked={isOwner || defaultGrant[a]}
                        disabled={locked}
                        onCheckedChange={(v) => setDefaultGrant((g) => ({ ...g, [a]: v === true }))}
                      />
                    </div>
                  </td>
                ))}
                {/* Record conditions apply per-object only, not to the default. */}
                <td className="text-center text-muted-foreground/40 text-xs">—</td>
                <td />
              </tr>

              {detail.objects.map((o) => {
                const entry = objects.get(o.id);
                const overridden = entry?.overridden ?? false;
                const grant = overridden ? (entry?.grant ?? defaultGrant) : defaultGrant;
                return (
                  <tr
                    key={o.id}
                    className="border-border border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <ObjChip label={o.label} color={o.color} size={20} />
                        <span className="font-medium text-foreground">{o.labelPlural}</span>
                        {overridden && (
                          <span
                            className="size-1.5 rounded-full bg-[var(--accent)]"
                            title="Overrides the default"
                          />
                        )}
                      </div>
                    </td>
                    {OBJECT_ACTIONS.map((a) => (
                      <td key={a} className="px-2 py-2.5 text-center">
                        <div className="flex justify-center">
                          <Checkbox
                            checked={isOwner || grant[a]}
                            disabled={locked}
                            className={cn(!overridden && 'opacity-60')}
                            onCheckedChange={(v) => toggleObjectCell(o.id, a, v === true)}
                          />
                        </div>
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-center">
                      {!isOwner && (
                        <div className="flex justify-center">
                          <RoleObjectCriteria
                            objectKey={o.key}
                            objectLabel={o.labelPlural}
                            value={entry?.filter ?? []}
                            disabled={locked}
                            onChange={(f) => setObjectFilter(o.id, f)}
                          />
                        </div>
                      )}
                    </td>
                    <td className="pr-4 text-right">
                      {overridden && !locked && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="Reset to default"
                              onClick={() => resetObject(o.id)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <RotateCcw className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Reset to default</TooltipContent>
                        </Tooltip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {detail.objects.length === 0 && (
          <div className="px-5 py-8 text-center text-muted-foreground text-sm">
            No objects yet. Create objects in the Object manager and they&apos;ll appear here.
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete role"
        description={`Delete "${detail.role.name}"? Members must be reassigned first. This can't be undone.`}
        confirmLabel="Delete role"
        tone="destructive"
        pending={deleteRole.isPending}
        onConfirm={async () => {
          try {
            await deleteRole.mutateAsync({ id: roleId });
            await Promise.all([utils.role.list.invalidate(), utils.me.bootstrap.invalidate()]);
            setConfirmDelete(false);
            onDeleted();
            toast.success('Role deleted');
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't delete the role");
          }
        }}
      />
    </div>
  );
}
