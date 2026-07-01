'use client';

import { Field } from '@/components/northbeam/field';
import { FormDialog } from '@/components/northbeam/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { ROLE_LABELS, type Role } from '@northbeam/core/roles';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

const INVITABLE_ROLES: Role[] = ['admin', 'member', 'viewer'];

const InviteSchema = z.object({
  email: z.string().email("That doesn't look like an email address."),
  role: z.enum(['admin', 'member', 'viewer'] as const),
});
type InviteFormValues = z.infer<typeof InviteSchema>;

export function InviteMemberDialog({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<InviteFormValues>({
    resolver: zodResolver(InviteSchema),
    mode: 'onBlur',
    defaultValues: { email: '', role: 'member' },
  });
  const invite = trpc.org.invite.useMutation({
    meta: { context: "Couldn't send invite" },
    onSuccess: () => {
      setOpen(false);
      form.reset({ email: '', role: 'member' });
      onInvited();
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset({ email: '', role: 'member' });
      }}
      trigger={
        <Button>
          <UserPlus />
          Invite
        </Button>
      }
      title="Invite a teammate"
      submitLabel={invite.isPending ? 'Sending…' : 'Send invite'}
      pending={invite.isPending}
      onSubmit={form.handleSubmit((values) =>
        invite.mutateAsync({ email: values.email.trim(), role: values.role }),
      )}
    >
      <Field
        label="Email"
        required
        htmlFor="invite-email"
        error={form.formState.errors.email?.message}
      >
        <Input
          id="invite-email"
          type="email"
          placeholder="teammate@company.com"
          autoFocus
          {...form.register('email')}
        />
      </Field>
      <Field label="Role" htmlFor="invite-role" error={form.formState.errors.role?.message}>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>
    </FormDialog>
  );
}
