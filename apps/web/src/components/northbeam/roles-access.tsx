'use client';

// RolesAccess — the roles & permissions surface, a P2×P3 blend:
//
//   • Persona cards on top (P3): every role as a card — color, member
//     avatars with in-context reassignment, capability meters, and the
//     manage menu (edit details / duplicate / delete-with-reason).
//   • The access matrix below (P2): roles as columns, permissions as rows,
//     so "who can do X" is answered in one glance. Workspace grants, the
//     per-object CRUD grid (with row criteria), and the AI tool policy all
//     live in ONE grid with ONE save model: every cell writes instantly,
//     stated plainly in the footer.
//
// Honesty rules the old editor broke, enforced here:
//   • Owner's column is all lock glyphs — it is immutable, so it never
//     renders as editable.
//   • Seed-granted permissions on system roles show a lock (they can't be
//     revoked — withSystemSeedPermissions unions the static seed back in),
//     instead of a toggle that silently reverts.
//   • Inheritance is labeled: overridden object cells carry a dot + reset,
//     not a 60%-opacity guess.

import { ObjChip } from '@/components/northbeam/app-bits';
import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { CreateRoleDialog } from '@/components/northbeam/create-role-dialog';
import { RoleObjectCriteria } from '@/components/northbeam/role-object-criteria';
import { RoleSelect } from '@/components/northbeam/role-select';
import { ADMIN_SWATCHES, SwatchPicker } from '@/components/northbeam/swatch-picker';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { type RouterOutputs, trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { cn } from '@/lib/cn';
import { AI_TOOLS, type AiToolKind, toolAllowedForRole } from '@northbeam/core/ai-tools';
import {
  type CrudGrant,
  OBJECT_ACTIONS,
  ORG_PERMISSION_KEYS,
  type ObjectAction,
  PERMISSION_GROUPS,
  SYSTEM_ROLE_SEEDS,
} from '@northbeam/core/roles';
import type { Filter } from '@northbeam/db/views';
import {
  Copy,
  Loader2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

type RoleListItem = RouterOutputs['role']['list'][number];
type RoleDetail = RouterOutputs['role']['get'];

const ORG_KEY_SET = new Set<string>(ORG_PERMISSION_KEYS);
const ORG_GROUPS = PERMISSION_GROUPS.map((g) => ({
  ...g,
  permissions: g.permissions.filter((p) => ORG_KEY_SET.has(p.key)),
})).filter((g) => g.permissions.length > 0);
const ORG_PERM_TOTAL = ORG_GROUPS.reduce((n, g) => n + g.permissions.length, 0);

const CRUD_LETTER: Record<ObjectAction, string> = {
  create: 'C',
  read: 'R',
  update: 'U',
  delete: 'D',
};

const TOOL_KIND_LABEL: Record<AiToolKind, string> = {
  read: 'Agent tools · Read',
  write: 'Agent tools · Write',
  destructive: 'Agent tools · Destructive',
};

/** Seed-granted org permissions per system role key — these can't be revoked
 *  (resolution unions the static seed back in), so the matrix locks them. */
const SEED_SETS = new Map<string, Set<string>>(
  SYSTEM_ROLE_SEEDS.map((s) => [s.key, new Set<string>(s.orgPermissions)]),
);

function initials(name: string | null, email: string): string {
  const src = name?.trim() || email;
  return src
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (w[0] ?? '').toUpperCase())
    .join('');
}

export function RolesAccess() {
  const utils = trpc.useUtils();
  const rolesQ = trpc.role.list.useQuery();
  const roles = rolesQ.data ?? [];
  const detailsQ = trpc.useQueries((t) => roles.map((r) => t.role.get({ id: r.id })));
  const membersQ = trpc.org.members.useQuery();
  const policyQ = trpc.ai.toolPolicyList.useQuery();
  const canMoveMembers = useCan('org.members.role');

  const detailByRoleId = useMemo(() => {
    const m = new Map<string, RoleDetail>();
    roles.forEach((r, i) => {
      const d = detailsQ[i]?.data;
      if (d) m.set(r.id, d);
    });
    return m;
  }, [roles, detailsQ]);

  const invalidateRole = async (roleId: string) => {
    await Promise.all([
      utils.role.get.invalidate({ id: roleId }),
      utils.role.list.invalidate(),
      utils.me.bootstrap.invalidate(),
    ]);
  };

  const updateRole = trpc.role.update.useMutation({
    meta: { context: "Couldn't update the role" },
    onSuccess: (_d, vars) => invalidateRole(vars.id),
  });
  const setObjPerm = trpc.role.setObjectPermission.useMutation({
    meta: { context: "Couldn't update object access" },
    onSuccess: (_d, vars) => invalidateRole(vars.roleId),
  });
  const deleteRole = trpc.role.delete.useMutation({
    meta: { context: "Couldn't delete the role" },
    onSuccess: () => Promise.all([utils.role.list.invalidate(), utils.me.bootstrap.invalidate()]),
  });
  const createRole = trpc.role.create.useMutation({
    meta: { context: "Couldn't duplicate the role" },
    onSuccess: () => utils.role.list.invalidate(),
  });
  const setMemberRole = trpc.org.setMemberRole.useMutation({
    meta: { context: "Couldn't move the member" },
    onSuccess: () => Promise.all([utils.org.members.invalidate(), utils.role.list.invalidate()]),
  });
  const setPolicy = trpc.ai.toolPolicySet.useMutation({
    meta: { context: "Couldn't update the tool policy" },
    onSuccess: () => utils.ai.toolPolicyList.invalidate(),
  });

  const overrides = policyQ.data?.overrides ?? [];
  const members = membersQ.data?.members ?? [];

  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoleListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleListItem | null>(null);

  const loading = rolesQ.isLoading || detailsQ.some((d) => d.isLoading);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const matches = (label: string) => !needle || label.toLowerCase().includes(needle);
  // Objects are identical across roles — take them from any loaded detail.
  const objects = detailByRoleId.get(roles[0]?.id ?? '')?.objects ?? [];

  const effectiveOrgPerms = (r: RoleListItem): Set<string> => {
    const detail = detailByRoleId.get(r.id);
    const stored = detail?.role.orgPermissions ?? [];
    const seed = r.isSystem ? (SEED_SETS.get(r.key) ?? new Set<string>()) : new Set<string>();
    return new Set([...stored, ...seed]);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── Persona cards ── */}
      <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((r) => (
          <RoleCard
            key={r.id}
            role={r}
            detail={detailByRoleId.get(r.id)}
            members={members.filter((m) => m.role === r.key)}
            aiAllowed={
              r.key === 'owner'
                ? AI_TOOLS.length
                : AI_TOOLS.filter((t) => toolAllowedForRole(overrides, t, r.key, false)).length
            }
            orgCount={r.key === 'owner' ? ORG_PERM_TOTAL : effectiveOrgPerms(r).size}
            canMoveMembers={canMoveMembers}
            onMoveMember={(memberId, roleKey) => setMemberRole.mutate({ memberId, role: roleKey })}
            onEdit={() => setEditTarget(r)}
            onDuplicate={() =>
              createRole.mutate(
                { name: `${r.name} copy`, copyFromRoleId: r.id },
                { onSuccess: () => toast.success(`Duplicated ${r.name}`) },
              )
            }
            onDelete={() => setDeleteTarget(r)}
          />
        ))}
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-border border-dashed text-muted-foreground text-sm transition-colors hover:border-[var(--border-strong)] hover:text-foreground"
        >
          <Plus className="size-4" />
          New role
        </button>
      </div>

      {/* ── Access matrix ── */}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-border border-b px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="font-medium text-foreground text-sm">Access matrix</h3>
            <p className="text-muted-foreground text-xs">
              Who can do what — every cell saves the moment you change it.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Legend />
            <div className="relative">
              <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter permissions…"
                className="h-8 w-52 pl-8"
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b bg-muted/40">
                <th className="min-w-[260px] px-5 py-2.5 text-left font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
                  Permission
                </th>
                {roles.map((r) => (
                  <th key={r.id} className="min-w-[104px] px-2 py-2.5 text-center align-top">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground text-xs">
                      <span
                        className="size-2 rounded-full ring-1 ring-black/5"
                        style={{ background: r.color ?? 'var(--brand)' }}
                      />
                      {r.name}
                      {r.key === 'owner' && <Lock className="size-3 text-muted-foreground/60" />}
                    </span>
                    <span className="block font-normal text-[11px] text-muted-foreground tabular-nums">
                      {r.memberCount} {r.memberCount === 1 ? 'member' : 'members'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Workspace permission groups */}
              {ORG_GROUPS.map((group) => {
                const rows = group.permissions.filter((p) => matches(p.label));
                if (rows.length === 0) return null;
                return (
                  <GroupRows key={group.id} label={group.label} span={roles.length + 1}>
                    {rows.map((p) => (
                      <tr key={p.key} className="border-border/60 border-b hover:bg-muted/30">
                        <td className="px-5 py-2">
                          <span className="block font-medium text-foreground text-sm">
                            {p.label}
                          </span>
                          {p.description && (
                            <span className="block text-muted-foreground text-xs">
                              {p.description}
                            </span>
                          )}
                        </td>
                        {roles.map((r) => (
                          <OrgCell
                            key={r.id}
                            role={r}
                            permKey={p.key}
                            granted={effectiveOrgPerms(r).has(p.key)}
                            stored={detailByRoleId.get(r.id)?.role.orgPermissions ?? []}
                            pending={updateRole.isPending}
                            onToggle={(next) =>
                              updateRole.mutate({ id: r.id, orgPermissions: next })
                            }
                          />
                        ))}
                      </tr>
                    ))}
                  </GroupRows>
                );
              })}

              {/* Object access */}
              <GroupRows label="Object access" span={roles.length + 1}>
                <tr className="border-border/60 border-b bg-[var(--accent-soft)]/40">
                  <td className="px-5 py-2">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">All objects</span>
                      <Badge tone="neutral" size="sm">
                        default
                      </Badge>
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      Applied to every object unless a row below overrides it.
                    </span>
                  </td>
                  {roles.map((r) => {
                    const detail = detailByRoleId.get(r.id);
                    return (
                      <td key={r.id} className="px-2 py-2 text-center">
                        {r.key === 'owner' || !detail ? (
                          <LockGlyph reason="The Owner role is immutable — full access." />
                        ) : (
                          <CrudCluster
                            grant={detail.role.defaultGrant}
                            pending={updateRole.isPending}
                            onToggle={(action, value) =>
                              updateRole.mutate({
                                id: r.id,
                                defaultGrant: { ...detail.role.defaultGrant, [action]: value },
                              })
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
                {objects
                  .filter((o) => matches(o.labelPlural))
                  .map((o) => (
                    <tr key={o.id} className="border-border/60 border-b hover:bg-muted/30">
                      <td className="px-5 py-2">
                        <span className="flex items-center gap-2.5">
                          <ObjChip label={o.label} color={o.color} size={20} />
                          <span className="font-medium text-foreground text-sm">
                            {o.labelPlural}
                          </span>
                        </span>
                      </td>
                      {roles.map((r) => (
                        <ObjectCell
                          key={r.id}
                          role={r}
                          detail={detailByRoleId.get(r.id)}
                          objectId={o.id}
                          objectKey={o.key}
                          objectLabel={o.labelPlural}
                          pending={setObjPerm.isPending}
                          onSet={(grant, filter) =>
                            setObjPerm.mutate({
                              roleId: r.id,
                              objectId: o.id,
                              grant,
                              filter,
                            })
                          }
                        />
                      ))}
                    </tr>
                  ))}
              </GroupRows>

              {/* AI tool policy — same grid, same instant saves */}
              {(['read', 'write', 'destructive'] as const).map((kind) => {
                const tools = AI_TOOLS.filter((t) => t.kind === kind && matches(t.title));
                if (tools.length === 0) return null;
                return (
                  <GroupRows key={kind} label={TOOL_KIND_LABEL[kind]} span={roles.length + 1}>
                    {tools.map((tool) => (
                      <tr key={tool.id} className="border-border/60 border-b hover:bg-muted/30">
                        <td className="px-5 py-2">
                          <span className="block font-medium text-foreground text-sm">
                            {tool.title}
                          </span>
                          <span className="block text-muted-foreground text-xs">
                            {tool.description}
                          </span>
                        </td>
                        {roles.map((r) =>
                          r.key === 'owner' ? (
                            <td key={r.id} className="px-2 py-2 text-center">
                              <LockGlyph reason="Owner always has every tool." />
                            </td>
                          ) : (
                            <td key={r.id} className="px-2 py-2 text-center">
                              <Checkbox
                                className="mx-auto"
                                checked={toolAllowedForRole(overrides, tool, r.key, false)}
                                disabled={setPolicy.isPending}
                                aria-label={`${tool.title} for ${r.name}`}
                                onCheckedChange={(on) =>
                                  setPolicy.mutate({
                                    roleKey: r.key,
                                    toolId: tool.id,
                                    allowed: on === true,
                                  })
                                }
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </GroupRows>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-border border-t px-5 py-2.5 text-muted-foreground text-xs">
          <span>Changes save instantly — no Save button, no drafts.</span>
          <a href="/setup/audit" className="font-medium text-link hover:underline">
            Every change lands in the audit log →
          </a>
        </div>
      </section>

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        copyOptions={roles.map((r) => ({ id: r.id, name: r.name }))}
        onCreated={() => undefined}
      />

      {editTarget && (
        <EditRoleDialog
          role={editTarget}
          detail={detailByRoleId.get(editTarget.id)}
          pending={updateRole.isPending}
          onClose={() => setEditTarget(null)}
          onSave={(patch) =>
            updateRole.mutate(
              { id: editTarget.id, ...patch },
              {
                onSuccess: () => {
                  setEditTarget(null);
                  toast.success('Role updated');
                },
              },
            )
          }
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete role"
        description={`Delete "${deleteTarget?.name ?? ''}"? This can't be undone.`}
        confirmLabel="Delete role"
        tone="destructive"
        pending={deleteRole.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteRole.mutate(
            { id: deleteTarget.id },
            {
              onSuccess: () => {
                setDeleteTarget(null);
                toast.success('Role deleted');
              },
            },
          );
        }}
      />
    </div>
  );
}

/* ── Persona card ───────────────────────────────────────────────────────── */

function RoleCard({
  role,
  detail,
  members,
  aiAllowed,
  orgCount,
  canMoveMembers,
  onMoveMember,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  role: RoleListItem;
  detail?: RoleDetail;
  members: RouterOutputs['org']['members']['members'];
  aiAllowed: number;
  orgCount: number;
  canMoveMembers: boolean;
  onMoveMember: (memberId: string, roleKey: string) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const isOwner = role.key === 'owner';
  const grant = detail?.role.defaultGrant;
  const overrideCount = detail?.objects.filter((o) => o.overridden).length ?? 0;
  const objectSummary = isOwner
    ? 'Full access'
    : grant
      ? `${
          grant.create && grant.read && grant.update && grant.delete
            ? 'Full access'
            : grant.read && !grant.create && !grant.update && !grant.delete
              ? 'Read-only'
              : OBJECT_ACTIONS.filter((a) => grant[a])
                  .map((a) => CRUD_LETTER[a])
                  .join('') || 'No access'
        }${overrideCount > 0 ? ` · ${overrideCount} override${overrideCount === 1 ? '' : 's'}` : ''}`
      : '—';

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1 size-3 shrink-0 rounded-full ring-1 ring-black/5"
          style={{ background: role.color ?? 'var(--brand)' }}
        />
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-foreground text-sm">{role.name}</span>
            <Badge tone={role.isSystem ? 'neutral' : 'brand'} size="sm">
              {role.isSystem ? 'System' : 'Custom'}
            </Badge>
          </span>
          <code className="text-[10.5px] text-muted-foreground">{role.key}</code>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label={`Manage ${role.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {!isOwner && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-3.5" />
                Edit details
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="size-3.5" />
              Duplicate
            </DropdownMenuItem>
            {!role.isSystem && (
              <DropdownMenuItem
                variant="destructive"
                disabled={role.memberCount > 0}
                title={
                  role.memberCount > 0
                    ? `${role.memberCount} member${role.memberCount === 1 ? '' : 's'} — move them first`
                    : undefined
                }
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" />
                {role.memberCount > 0 ? `Delete (${role.memberCount} members)` : 'Delete'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Members — visible AND reassignable in place. */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted"
            aria-label={`Members with the ${role.name} role`}
          >
            {members.length === 0 ? (
              <span className="text-muted-foreground text-xs">No members</span>
            ) : (
              <>
                <span className="flex -space-x-1.5">
                  {members.slice(0, 4).map((m) => (
                    <span
                      key={m.id}
                      title={m.name ?? m.email}
                      className="grid size-5 place-items-center rounded-full bg-primary text-[8.5px] text-primary-foreground ring-2 ring-card"
                    >
                      {initials(m.name, m.email)}
                    </span>
                  ))}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {members.length} {members.length === 1 ? 'member' : 'members'}
                </span>
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <p className="font-medium text-sm">Members · {role.name}</p>
          <div className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto">
            {members.length === 0 && (
              <p className="text-muted-foreground text-xs">
                Nobody holds this role. Assign members from the list on other role cards, or from
                Setup → Users.
              </p>
            )}
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[9px] text-primary-foreground">
                  {initials(m.name, m.email)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.name ?? m.email}</span>
                  <span className="block truncate text-muted-foreground text-xs">{m.email}</span>
                </span>
                {canMoveMembers && role.key !== 'owner' && (
                  <span className="w-32 shrink-0">
                    <RoleSelect value={m.role} onChange={(next) => onMoveMember(m.id, next)} />
                  </span>
                )}
              </div>
            ))}
          </div>
          {!role.isSystem && members.length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Deleting this role requires zero members — move them here first.
            </p>
          )}
        </PopoverContent>
      </Popover>

      {/* Capability meters */}
      <div className="mt-auto flex flex-col gap-1.5 text-xs">
        <Meter label="Workspace" value={orgCount} total={ORG_PERM_TOTAL} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Objects</span>
          <span className="truncate font-medium text-foreground tabular-nums">{objectSummary}</span>
        </div>
        <Meter label="Agent tools" value={aiAllowed} total={AI_TOOLS.length} />
      </div>
    </div>
  );
}

function Meter({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${total > 0 ? Math.round((value / total) * 100) : 0}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right font-medium text-foreground tabular-nums">
        {value}/{total}
      </span>
    </div>
  );
}

/* ── Matrix cells ───────────────────────────────────────────────────────── */

function Legend() {
  return (
    <span className="hidden items-center gap-3 text-[11px] text-muted-foreground lg:flex">
      <span className="flex items-center gap-1">
        <Checkbox checked disabled className="pointer-events-none size-3.5" /> granted
      </span>
      <span className="flex items-center gap-1">
        <Checkbox disabled className="pointer-events-none size-3.5" /> not granted
      </span>
      <span className="flex items-center gap-1">
        <Lock className="size-3" /> locked
      </span>
      <span className="flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-[var(--accent)]" /> override
      </span>
    </span>
  );
}

function GroupRows({
  label,
  span,
  children,
}: {
  label: string;
  span: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="border-border border-b bg-muted/40">
        <td
          colSpan={span}
          className="px-5 py-1.5 font-medium text-[0.65rem] text-muted-foreground uppercase tracking-[0.1em]"
        >
          {label}
        </td>
      </tr>
      {children}
    </>
  );
}

function LockGlyph({ reason }: { reason: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-grid size-5 place-items-center rounded bg-muted text-muted-foreground">
          <Lock className="size-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function OrgCell({
  role,
  permKey,
  granted,
  stored,
  pending,
  onToggle,
}: {
  role: RoleListItem;
  permKey: string;
  granted: boolean;
  stored: string[];
  pending: boolean;
  onToggle: (nextOrgPermissions: string[]) => void;
}) {
  if (role.key === 'owner') {
    return (
      <td className="px-2 py-2 text-center">
        <LockGlyph reason="The Owner role is immutable — full access." />
      </td>
    );
  }
  const seedGranted = role.isSystem && (SEED_SETS.get(role.key)?.has(permKey) ?? false);
  if (seedGranted) {
    return (
      <td className="px-2 py-2 text-center">
        <LockGlyph
          reason={`Granted by the ${role.name} system role — can't be revoked. Use a custom role instead.`}
        />
      </td>
    );
  }
  return (
    <td className="px-2 py-2 text-center">
      <Checkbox
        className="mx-auto"
        checked={granted}
        disabled={pending}
        aria-label={`${permKey} for ${role.name}`}
        onCheckedChange={(on) =>
          onToggle(
            on === true ? [...new Set([...stored, permKey])] : stored.filter((k) => k !== permKey),
          )
        }
      />
    </td>
  );
}

/** The four-letter CRUD cluster. Each letter is a toggle; granted letters
 *  fill accent, missing ones stay hairline. */
function CrudCluster({
  grant,
  pending,
  onToggle,
}: {
  grant: CrudGrant;
  pending: boolean;
  onToggle: (action: ObjectAction, value: boolean) => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-border">
      {OBJECT_ACTIONS.map((a) => {
        const on = grant[a];
        return (
          <button
            key={a}
            type="button"
            disabled={pending}
            title={`${a[0]?.toUpperCase()}${a.slice(1)}`}
            aria-pressed={on}
            onClick={() => onToggle(a, !on)}
            className={cn(
              'grid size-6 place-items-center border-border/60 border-l font-medium font-mono text-[10.5px] transition-colors first:border-l-0',
              on
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-muted-foreground/50 hover:text-foreground',
            )}
          >
            {CRUD_LETTER[a]}
          </button>
        );
      })}
    </span>
  );
}

function ObjectCell({
  role,
  detail,
  objectId,
  objectKey,
  objectLabel,
  pending,
  onSet,
}: {
  role: RoleListItem;
  detail?: RoleDetail;
  objectId: string;
  objectKey: string;
  objectLabel: string;
  pending: boolean;
  onSet: (grant: CrudGrant | null, filter: Filter[] | null) => void;
}) {
  if (role.key === 'owner' || !detail) {
    return (
      <td className="px-2 py-2 text-center">
        <LockGlyph reason="The Owner role is immutable — full access." />
      </td>
    );
  }
  const entry = detail.objects.find((o) => o.id === objectId);
  const overridden = entry?.overridden ?? false;
  const filter = (entry?.filter ?? []) as Filter[];
  const grant = overridden ? (entry?.grant ?? detail.role.defaultGrant) : detail.role.defaultGrant;

  return (
    <td className="group/cell px-2 py-2 text-center">
      <span className="inline-flex flex-col items-center gap-1">
        <CrudCluster
          grant={grant}
          pending={pending}
          onToggle={(action, value) =>
            onSet({ ...grant, [action]: value }, filter.length > 0 ? filter : null)
          }
        />
        <span className="flex h-4 items-center gap-1.5">
          {overridden && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="size-1.5 rounded-full bg-[var(--accent)]" />
              </TooltipTrigger>
              <TooltipContent>Overrides this role's default</TooltipContent>
            </Tooltip>
          )}
          <span
            className={cn(
              'flex items-center gap-1',
              !overridden && filter.length === 0 && 'opacity-0 group-hover/cell:opacity-100',
            )}
          >
            <RoleObjectCriteria
              objectKey={objectKey}
              objectLabel={objectLabel}
              value={filter}
              disabled={pending}
              onChange={(f) => onSet(grant, f.length > 0 ? f : null)}
            />
            {overridden && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Reset to default"
                    disabled={pending}
                    onClick={() => onSet(null, null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <RotateCcw className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Reset to this role's default</TooltipContent>
              </Tooltip>
            )}
          </span>
        </span>
      </span>
    </td>
  );
}

/* ── Edit details dialog ────────────────────────────────────────────────── */

function EditRoleDialog({
  role,
  detail,
  pending,
  onClose,
  onSave,
}: {
  role: RoleListItem;
  detail?: RoleDetail;
  pending: boolean;
  onClose: () => void;
  onSave: (patch: { name?: string; description?: string; color?: string }) => void;
}) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(detail?.role.description ?? '');
  const [color, setColor] = useState(role.color ?? ADMIN_SWATCHES[0]?.value ?? '');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit role</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <label htmlFor="edit-role-name" className="flex flex-col gap-1.5">
            <span className="font-medium text-muted-foreground text-xs">Name</span>
            <Input
              id="edit-role-name"
              value={name}
              disabled={role.isSystem}
              onChange={(e) => setName(e.target.value)}
            />
            {role.isSystem && (
              <span className="text-[11px] text-muted-foreground">
                System roles can't be renamed.
              </span>
            )}
          </label>
          <label htmlFor="edit-role-desc" className="flex flex-col gap-1.5">
            <span className="font-medium text-muted-foreground text-xs">Description</span>
            <Textarea
              id="edit-role-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-muted-foreground text-xs">Color</span>
            <SwatchPicker swatches={ADMIN_SWATCHES} value={color} onChange={setColor} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || name.trim().length === 0}
            onClick={() => onSave({ name: name.trim(), description, color })}
          >
            {pending && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
