// Root tRPC router. The exported `AppRouter` type is imported by apps/web to
// drive end-to-end-typed client + TanStack Query hooks.

import { aiRouter } from './routers/ai.js';
import { auditRouter } from './routers/audit.js';
import { authRouter } from './routers/auth.js';
import { fieldRouter } from './routers/field.js';
import { homeRouter } from './routers/home.js';
import { layoutRouter } from './routers/layout.js';
import { meRouter } from './routers/me.js';
import { objectRouter } from './routers/object.js';
import { orgRouter } from './routers/org.js';
import { picklistRouter } from './routers/picklist.js';
import { recordTypeRouter } from './routers/record-type.js';
import { recordRouter } from './routers/record.js';
import { salesforceRouter } from './routers/salesforce.js';
import { validationRouter } from './routers/validation.js';
import { viewRouter } from './routers/view.js';
import { router } from './trpc.js';

export const appRouter = router({
  ai: aiRouter,
  audit: auditRouter,
  auth: authRouter,
  field: fieldRouter,
  home: homeRouter,
  layout: layoutRouter,
  me: meRouter,
  object: objectRouter,
  org: orgRouter,
  picklist: picklistRouter,
  record: recordRouter,
  recordType: recordTypeRouter,
  salesforce: salesforceRouter,
  validation: validationRouter,
  view: viewRouter,
});

export type AppRouter = typeof appRouter;
export { createContext } from './context.js';
