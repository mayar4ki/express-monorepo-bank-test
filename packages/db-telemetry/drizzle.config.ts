import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.TELEMETRY_DATABASE_URL ?? 'postgres://bank:bank@localhost:5433/bank_telemetry',
  },
});
