import { defineConfig } from 'tsup';

// Bundles apps/api into a self-contained dist/index.js. Workspace packages
// (@northbeam/core, @northbeam/db, @northbeam/config) ship as TS source with no
// dist/, so they must be inlined; everything in node_modules stays external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  skipNodeModulesBundle: true,
  noExternal: [/^@northbeam\//],
  dts: false,
  sourcemap: true,
});
