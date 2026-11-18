import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error('DATABASE_URL is required to connect ResolveIQ to PostgreSQL.');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(connectionString);
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
    }
    if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
      throw new Error('DATABASE_URL must use the postgres or postgresql scheme.');
    }
    if (!parsedUrl.hostname || !parsedUrl.username || !parsedUrl.password || !parsedUrl.pathname.slice(1)) {
      throw new Error('DATABASE_URL must include a host, username, password, and database name.');
    }

    if (process.env.SQL_SSL?.toLowerCase() === 'true') {
      parsedUrl.searchParams.set('sslmode', 'require');
    }
    global._postgresPool = new Pool({
      // Let pg-connection-string interpret sslmode=require from the URL. Passing
      // a separate ssl object overrides URL SSL parameters in node-postgres.
      connectionString: parsedUrl.toString(),
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', () => {
      console.error('Unexpected error on an idle PostgreSQL pool connection.');
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
export { pool };
