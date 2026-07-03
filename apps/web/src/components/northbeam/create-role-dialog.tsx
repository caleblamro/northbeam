'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from './field';

/** Palette of role chip colors — a small curated set so custom roles stay
 *  visually cohesive with the brand rather than an arbitrary color wheel. */
const ROLE_COLORS = [
  '#635bff', // brand indigo
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
];

export function CreateRoleDialog({
  open,
  onOpenChange,
  copyOptions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Roles that can be used as a starting template. */
  copyOptions: { id: string; name: string }[];
  onCreated: (roleId: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(ROLE_COLORS[0]);
  const [copyFrom, setCopyFrom] = useState<string>('none');

  const utils = trpc.useUtils();
  const create = trpc.role.create.useMutation({
    meta: { context: "Couldn't create the role" },
    onSuccess: async (r) => {
      await utils.role.list.invalidate();
      onCreated(r.id);
      onOpenChange(false);
      setName('');
      setDescription('');
      setColor(ROLE_COLORS[0]);
      setCopyFrom('none');
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            Roles bundle workspace permissions and per-object access. You&apos;ll set what it can do
            after creating it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          <Field label="Name" htmlFor="role-name">
            <Input
              id="role-name"
              value={name}
              autoFocus
              placeholder="e.g. Sales Rep"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {ROLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use color ${c}`}
                  aria-pressed={c === color}
                  onClick={() => setColor(c)}
                  className="size-6 rounded-full ring-offset-2 ring-offset-background transition-[box-shadow] data-[on=true]:ring-2 data-[on=true]:ring-ring"
                  data-on={c === color ? 'true' : undefined}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>

          <Field
            label="Description"
            htmlFor="role-desc"
            description="Optional — shown in the roles list."
          >
            <Textarea
              id="role-desc"
              rows={2}
              value={description}
              placeholder="What is this role for?"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field
            label="Start from"
            description="Copy another role's permissions as a starting point."
          >
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Blank (read-only)</SelectItem>
                {copyOptions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Copy of {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() =>
              create.mutate({
                name: name.trim(),
                description: description.trim() || undefined,
                color,
                copyFromRoleId: copyFrom === 'none' ? undefined : copyFrom,
              })
            }
          >
            {create.isPending && <Loader2 className="animate-spin" />}
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
