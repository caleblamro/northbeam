'use client';

import { Button } from '@/components/ui/button';
import { EmailInput, Field } from '@/components/ui/input';
import { trpc } from '@/lib/api';
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
        <h1
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            margin: '0 0 10px',
          }}
        >
          Check your inbox
        </h1>
        <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.55, margin: 0 }}>
          We sent a magic link to <b>{email}</b>. Click it to finish signing in — it expires in 10
          minutes.
        </p>
        <p style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)', marginTop: 14 }}>
          In local dev the link is printed in the API server console.
        </p>
        <div style={{ marginTop: 22 }}>
          <Button
            variant="link"
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
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '0 0 8px',
        }}
      >
        Sign in to Northbeam
      </h1>
      <p style={{ color: 'var(--ink-muted)', margin: '0 0 22px', lineHeight: 1.5 }}>
        Enter your email and we'll send you a magic link.
      </p>
      <Field label="Work email" htmlFor="email">
        <EmailInput value={email} onChange={setEmail} />
      </Field>
      <div style={{ marginTop: 18 }}>
        <Button type="submit" block loading={requestLink.isPending} disabled={!email.trim()}>
          Send magic link
        </Button>
      </div>
      {requestLink.isError && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginTop: 12 }}>
          {requestLink.error.message}
        </p>
      )}
    </form>
  );
}
