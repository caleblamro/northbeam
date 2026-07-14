// Root tRPC router. The exported `AppRouter` type is imported by apps/web to
// drive end-to-end-typed client + TanStack Query hooks.

import { agentRouter } from './routers/agent.js';
import { aiRouter } from './routers/ai.js';
import { auditRouter } from './routers/audit.js';
import { commentRouter } from './routers/comment.js';
import { authRouter } from './routers/auth.js';
import { automationRouter } from './routers/automation.js';
import { fieldRouter } from './routers/field.js';
import { homeRouter } from './routers/home.js';
import { layoutRouter } from './routers/layout.js';
import { meRouter } from './routers/me.js';
import { notificationRouter } from './routers/notification.js';
import { objectRouter } from './routers/object.js';
import { orgRouter } from './routers/org.js';
import { picklistRouter } from './routers/picklist.js';
import { recordTypeRouter } from './routers/record-type.js';
import { recordRouter } from './routers/record.js';
import { roleRouter } from './routers/role.js';
import { salesforceRouter } from './routers/salesforce.js';
import { validationRouter } from './routers/validation.js';
import { viewRouter } from './routers/view.js';
import { router } from './trpc.js';

export const appRouter = router({
  agent: agentRouter,
  ai: aiRouter,
  audit: auditRouter,
  comment: commentRouter,
  auth: authRouter,
  automation: automationRouter,
  field: fieldRouter,
  notification: notificationRouter,
  home: homeRouter,
  layout: layoutRouter,
  me: meRouter,
  object: objectRouter,
  org: orgRouter,
  picklist: picklistRouter,
  record: recordRouter,
  recordType: recordTypeRouter,
  role: roleRouter,
  salesforce: salesforceRouter,
  validation: validationRouter,
  view: viewRouter,
});

export type AppRouter = typeof appRouter;
export { createContext } from './context.js';
