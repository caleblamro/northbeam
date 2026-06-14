// Centralized error formatting + toast notification for tRPC failures.
//
// Two surfaces wire into this:
//   - QueryCache / MutationCache global onError handlers in ApiProvider —
//     anything that bubbles past per-call `onError` lands here.
//   - Pages that want to fire a contextual toast manually (e.g. catching a
//     mutation, doing something custom, then surfacing the error).
//
// tRPC errors arrive as TRPCClientError instances; we sniff `.data.code` to
// produce a friendly title and pass the original message through as the body.

import { TRPCClientError } from '@trpc/client';
import { toast } from 'sonner';

export type FormattedError = { title: string; body?: string; code?: string };

const TITLE_BY_CODE: Record<string, string> = {
  UNAUTHORIZED: 'Sign in required',
  FORBIDDEN: 'Not allowed',
  NOT_FOUND: 'Not found',
  BAD_REQUEST: 'Invalid input',
  CONFLICT: 'Conflict',
  TIMEOUT: 'Request timed out',
  TOO_MANY_REQUESTS: 'Too many requests',
  INTERNAL_SERVER_ERROR: 'Server error',
  PARSE_ERROR: 'Server error',
  CLIENT_CLOSED_REQUEST: 'Connection lost',
};

export function formatError(err: unknown): FormattedError {
  if (err instanceof TRPCClientError) {
    const code = (err.data as { code?: string } | null)?.code;
    const title = (code && TITLE_BY_CODE[code]) ?? 'Something went wrong';
    return { title, body: err.message, code };
  }
  if (err instanceof Error) {
    return { title: 'Something went wrong', body: err.message };
  }
  return { title: 'Something went wrong' };
}

/** Fire a toast for an error. `context` is a short verb phrase ("Couldn't
 *  save changes", "Couldn't delete record") — when present, it becomes the
 *  title and the formatted-error title is folded into the body. */
export function notifyError(err: unknown, context?: string): void {
  const f = formatError(err);
  if (context) {
    toast.error(context, {
      description: f.body ?? f.title,
    });
  } else {
    toast.error(f.title, { description: f.body });
  }
}

/** Codes we deliberately swallow from the global toaster — the page is
 *  responsible for handling them (typically by redirecting). */
export function isSilentlyHandledCode(code: string | undefined): boolean {
  // Auth errors → the affected page should redirect to /sign-in; a toast on
  // top of the redirect is noisy and confusing.
  return code === 'UNAUTHORIZED';
}
