// Public entrypoint for the dashboard's API layer.
// Pages:  `import { trpc } from '@/lib/api'`
// Layout: `import { ApiProvider } from '@/lib/api'`
export { trpc, type AppRouter, type RouterInputs, type RouterOutputs } from './trpc';
export { ApiProvider } from './provider';
