'use client';

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const Schema = z.object({
  email: z.string().email("That doesn't look like an email address."),
});
type FormValues = z.infer<typeof Schema>;

export default function SignInPage() {
  const requestLink = trpc.auth.requestMagicLink.useMutation({ meta: { silent: true } });
  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit((values) =>
    requestLink.mutateAsync({
      email: values.email.trim(),
      callbackURL: `${window.location.origin}/verify`,
    }),
  );

  if (requestLink.isSuccess) {
    return (
      <div>
        <h1 className="reveal mb-2 font-medium text-2xl tracking-[-0.02em]">Check your inbox</h1>
        <p className="reveal reveal-1 m-0 text-muted-foreground leading-relaxed">
          We sent a magic link to{' '}
          <span className="font-medium text-foreground">{form.getValues('email')}</span>. Click it
          to finish signing in — it expires in 10 minutes.
        </p>
        <p className="reveal reveal-2 mt-4 text-muted-foreground text-sm">
          In local dev the link is printed in the API server console.
        </p>
        <div className="reveal reveal-3 mt-6">
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              requestLink.reset();
              form.reset({ email: '' });
            }}
          >
            ← Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <h1 className="reveal mb-2 font-medium text-2xl tracking-[-0.02em]">Sign in to Northbeam</h1>
      <p className="reveal reveal-1 mb-6 text-muted-foreground leading-relaxed">
        Enter your email and we'll send you a magic link.
      </p>
      <div className="reveal reveal-2">
        <Field label="Work email" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            {...form.register('email')}
          />
        </Field>
      </div>
      <div className="reveal reveal-3 mt-5">
        <Button type="submit" className="w-full" disabled={requestLink.isPending}>
          {requestLink.isPending && <Loader2 className="size-4 animate-spin" />}
          Send magic link
        </Button>
      </div>
      {requestLink.isError && (
        <p className="mt-3 text-destructive text-sm">{requestLink.error.message}</p>
      )}
    </form>
  );
}
