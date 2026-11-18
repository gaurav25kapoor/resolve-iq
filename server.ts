import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from './src/db/index.ts';
import { appUsers, clients, historicalTickets } from './src/db/schema.ts';
import { count } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import { apiRouter } from './src/server/routes.ts';

const REQUIRED_TABLES = [
  'app_users', 'clients', 'user_client_access', 'historical_tickets',
  'diagnostic_checklists', 'checklist_items', 'workflow_tickets',
  'investigation_check_results', 'ai_analyses', 'engineering_escalations', 'audit_logs',
];

async function createServer() {
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    throw new Error('AUTH_SECRET must be configured with at least 32 characters.');
  }

  // Probe the configured Render PostgreSQL database before accepting requests.
  await pool.query('SELECT 1');
  const tableResult = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const existingTables = new Set(tableResult.rows.map((row: { table_name: string }) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((name) => !existingTables.has(name));
  if (missingTables.length) {
    throw new Error(
      `PostgreSQL public schema check failed. Missing: ${missingTables.join(', ')}. Found: ${Array.from(existingTables).sort().join(', ') || '(none)'}. No migration or seed was run.`
    );
  }
  const [ticketCount] = await db.select({ value: count() }).from(historicalTickets);
  const [clientCount] = await db.select({ value: count() }).from(clients);
  const [userCount] = await db.select({ value: count() }).from(appUsers);
  console.log(
    `Connected to PostgreSQL; verified ${existingTables.size} public tables, ${ticketCount.value} historical tickets, ${clientCount.value} clients, and ${userCount.value} users.`
  );

  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '2mb' }));

  // The app only starts listening after the database/schema readiness checks above pass.
  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.status(200).json({ ok: true, service: 'resolveiq' });
  };
  app.get('/health', healthHandler);
  app.get('/api/health', healthHandler);

  app.use('/api', apiRouter);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`ResolveIQ server listening on http://0.0.0.0:${port}`);
  });
}

createServer().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  const safeMessage = message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted connection URL]');
  console.error(
    `ResolveIQ startup failed: ${safeMessage}. Check DATABASE_URL, AUTH_SECRET, network access, and the existing PostgreSQL schema.`
  );
  process.exit(1);
});
