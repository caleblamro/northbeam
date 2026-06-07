// Root tRPC router. The exported `AppRouter` type is imported by apps/web to
// drive end-to-end-typed client + TanStack Query hooks.

import { authRouter } from './routers/auth.js';
import { meRouter } from './routers/me.js';
import { orgRouter } from './routers/org.js';
import { router } from './trpc.js';

export const appRouter = router({
  auth: authRouter,
  me: meRouter,
  org: orgRouter,
});

export type AppRouter = typeof appRouter;
export { createContext } from './context.js';
