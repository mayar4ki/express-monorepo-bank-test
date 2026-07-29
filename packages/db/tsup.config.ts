import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { migrate: 'scripts/migrate.ts' },
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  sourcemap: true,
  clean: true,
});
