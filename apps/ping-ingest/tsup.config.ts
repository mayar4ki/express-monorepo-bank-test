import { defineConfig } from 'tsup';

export default defineConfig({
  // `index` (not `main`, as the other apps use) so the built entry is dist/index.js.
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Workspace packages are TS source — inline them into the bundle.
  noExternal: [/^@acme\//],
});
