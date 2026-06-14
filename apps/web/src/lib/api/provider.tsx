'use client';

// Wraps the app in TanStack Query + tRPC providers. Mounted once in the root
// layout. Pages call `trpc.foo.bar.useQuery()` / `.useMutation()` directly.
//
// Errors:
//   - Mutations toast by default via MutationCache.onError. To suppress (for
//     mutations that show their own inline error UI), pass
//     `meta: { silent: true }` to the mutation.
//   - Queries do NOT toast on failure — components decide whether to render
//     an inline error or trigger a retry. The retry policy below handles
//     transient network blips.

import { formatError, isSilentlyHandledCode, notifyError } from '@/lib/api/errors';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { useState } from 'react';
import superjson from 'superjson';
import { trpc } from './trpc';

// Dev default: apps/api lives on :8000. Override via NEXT_PUBLIC_API_URL.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          // Only log query failures — components own the inline error UI. The
          // log is genuine signal in dev; in prod it lands wherever console
          // is wired (Sentry / Datadog).
          onError: (error, query) => {
            const f = formatError(error);
            if (isSilentlyHandledCode(f.code)) return;
            // eslint-disable-next-line no-console
            console.warn(`[query ${query.queryKey.join('.')}] ${f.title}: ${f.body ?? ''}`);
          },
        }),
        mutationCache: new MutationCache({
          // Every mutation that doesn't opt out gets a friendly toast.
          // Mutations with their own error UI should set
          // `meta: { silent: true }` to avoid duplicating the message.
          onError: (error, _vars, _ctx, mutation) => {
            if (mutation.meta?.silent) return;
            const f = formatError(error);
            if (isSilentlyHandledCode(f.code)) return;
            const context =
              (mutation.meta?.context as string | undefined) ?? "Couldn't complete that action";
            notifyError(error, context);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${API_URL}/trpc`,
          // Session cookie has to ride along on cross-origin requests.
          fetch: (url, options) => fetch(url, { ...options, credentials: 'include' }),
          transformer: superjson,
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
