'use client';

// Top-level Next.js error boundary. Catches render-time crashes in any (app)
// page that escape per-component handling. tRPC mutation/query errors are
// surfaced separately by the global MutationCache / QueryCache in
// ApiProvider — this file is the last-resort backstop.

import { Button } from '@/components/ui/button';
import { formatError } from '@/lib/api/errors';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Send to the wired logger when it lands (#7 in the coord brief). For
    // now, console is the sink so dev sees the stack inline.
    // eslint-disable-next-line no-console
    console.error('[app error boundary]', error);
  }, [error]);

  const f = formatError(error);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="font-semibold text-foreground text-lg">{f.title}</h1>
        <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
          {f.body ?? 'An unexpected error broke this page. Reloading usually clears it.'}
        </p>
        {error.digest && (
          <code className="mt-3 rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
            ref {error.digest}
          </code>
        )}
        <div className="mt-5 flex gap-2">
          <Button variant="outline" onClick={() => reset()}>
            <RotateCcw className="size-4" />
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </div>
    </div>
  );
}
