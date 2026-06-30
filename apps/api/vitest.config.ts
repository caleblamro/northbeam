import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live in a top-level `tests/` directory (alongside src/), not
    // colocated under src/ — keeps the tsup build output clean (the bundler
    // only sees app code, never .test.ts files). Mirrors @northbeam/db.
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
