import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live in a top-level `tests/` directory (alongside src/), not
    // colocated under src/. This keeps tsup's build output clean — the bundler
    // only sees app code, never .test.ts files — and matches the dominant
    // convention in TS monorepos with a separate build step.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
