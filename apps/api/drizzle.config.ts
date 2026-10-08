import { defineConfig } from 'drizzle-kit';

// `pnpm --filter @rumbo/api db:generate` writes a new SQL migration in
// ./drizzle after a schema change; the API applies pending ones on start.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
