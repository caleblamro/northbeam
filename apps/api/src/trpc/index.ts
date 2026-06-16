// Root tRPC router. The exported `AppRouter` type is imported by apps/web to
// drive end-to-end-typed client + TanStack Query hooks.

import { authRouter } from './routers/auth.js';
import { homeRouter } from './routers/home.js';
import { layoutRouter } from './routers/layout.js';
import { meRouter } from './routers/me.js';
import { objectRouter } from './routers/object.js';
import { orgRouter } from './routers/org.js';
import { recordRouter } from './routers/record.js';
import { salesforceRouter } from './routers/salesforce.js';
import { viewRouter } from './routers/view.js';
import { router } from './trpc.js';

export const appRouter = router({
  auth: authRouter,
  home: homeRouter,
  layout: layoutRouter,
  me: meRouter,
  object: objectRouter,
  org: orgRouter,
  record: recordRouter,
  salesforce: salesforceRouter,
  view: viewRouter,
});

export type AppRouter = typeof appRouter;
export { createContext } from './context.js';
