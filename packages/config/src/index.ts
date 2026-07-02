import { z } from 'zod';

export { BRAND, type Brand } from './brand';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),
  // Optional — AI artifact generation (#11). Missing key disables the
  // `ai.preview` procedure with a friendly tRPC error rather than failing
  // at boot, so local dev without an Anthropic key still runs.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Anthropic model id used by the artifact generator. Override for fast /
   *  cheap iterations or to A/B a newer model. */
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}
