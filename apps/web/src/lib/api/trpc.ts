// Typed tRPC react hooks. Import `trpc` everywhere the dashboard calls our API.
// AppRouter type is imported directly from apps/api over the workspace — types
// flow, no codegen, no duplication.

import type { AppRouter } from '@northbeam/api/trpc';
import { createTRPCReact } from '@trpc/react-query';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

export const trpc = createTRPCReact<AppRouter>();

export type { AppRouter };
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
