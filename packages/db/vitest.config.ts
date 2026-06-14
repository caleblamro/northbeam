import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The dynamic SQL layer is pure helpers; no DB needed for unit tests.
    // Integration tests (record CRUD against a real Postgres) live in
    // apps/api and run separately.
    environment: 'node',
    globals: false,
  },
});
