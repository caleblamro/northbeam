'use client';

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const requestLink = trpc.auth.requestMagicLink.useMutation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    requestLink.mutate({
      email: email.trim(),
      callbackURL: `${window.location.origin}/verify`,
    });
  };

  if (requestLink.isSuccess) {
    return (
      <div>
        <h1 className="mb-2 font-medium text-2xl tracking-[-0.02em]">Check your inbox</h1>
        <p className="m-0 text-muted-foreground leading-relaxed">
          We sent a magic link to <span className="font-medium text-foreground">{email}</span>.
          Click it to finish signing in — it expires in 10 minutes.
        </p>
        <p className="mt-4 text-muted-foreground text-sm">
          In local dev the link is printed in the API server console.
        </p>
        <div className="mt-5">
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              requestLink.reset();
              setEmail('');
            }}
          >
            ← Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1 className="mb-2 font-medium text-2xl tracking-[-0.02em]">Sign in to Northbeam</h1>
      <p className="mb-6 text-muted-foreground leading-relaxed">
        Enter your email and we'll send you a magic link.
      </p>
      <Field label="Work email" htmlFor="email">
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </Field>
      <div className="mt-4">
        <Button
          type="submit"
          className="w-full"
          disabled={!email.trim() || requestLink.isPending}
        >
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
