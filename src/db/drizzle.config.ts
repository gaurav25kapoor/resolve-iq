import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const databaseUrlValue = process.env.DATABASE_URL?.trim();
const databaseUrl = databaseUrlValue ? new URL(databaseUrlValue) : null;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set in environment variables.');
}
if (process.env.SQL_SSL?.toLowerCase() === 'true') {
  databaseUrl.searchParams.set('sslmode', 'require');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    url: databaseUrl.toString(),
  },
  verbose: true,
});
