# ResolveIQ Production Readiness Report

**Date:** 18 November 2026  
**Target:** One Render Web Service serving the Vite React frontend and Express API

## Executive result

The current architecture is compatible with a single Render Web Service. Express serves the production Vite output from `dist`, API calls use same-origin `/api` paths, the server binds to `0.0.0.0`, and the port is read from `process.env.PORT`.

The repository is not publicly deployed from this environment. Static checks pass, but runtime verification against the existing Render PostgreSQL database was blocked by the restricted execution environment: the configured database connection returned `EACCES` for TCP access to port 5432. The existing database was not reset, recreated, migrated, seeded, or modified.

## Repository inspection

| Area | Finding | Readiness |
|---|---|---|
| Frontend entry | `src/main.tsx` mounts `src/App.tsx`; Vite builds the React application into `dist` | Ready |
| Backend entry | `server.ts` creates Express, mounts `/api`, serves `dist` in production, and starts the listener | Ready |
| Build | `npm run build` runs `vite build` | Passed |
| Production start | `npm start` runs `node --experimental-strip-types server.ts` | Ready; aligned with the TypeScript runtime used by `dev` |
| Port and bind | `PORT` with a 3000 fallback; `app.listen(port, '0.0.0.0')` | Ready |
| SPA fallback | Express serves `dist/index.html` for non-API routes in production | Ready |
| API URL strategy | Frontend `fetch` calls use relative paths such as `/api/tickets` | Ready for same-origin deployment |
| CORS | No cross-origin frontend/API call is needed for this architecture; same-origin requests do not require CORS middleware | Appropriate as configured |
| Database | `DATABASE_URL` is parsed and used by `pg.Pool`/Drizzle; `SQL_SSL=true` forces `sslmode=require` | Ready; live connectivity unverified here |
| Migrations | Drizzle SQL migrations are applied manually with `npm run db:migrate`; startup does not run migrations | Safe deployment model |
| Authentication | Demo login uses an HMAC token signed by `AUTH_SECRET`; Google SSO uses Firebase client config and server-side Firebase Admin verification | Requires Render/Firebase configuration |
| Gemini | `GEMINI_API_KEY` is read server-side only; deterministic TF-IDF fallback works without it | Optional, with degraded AI mode when absent |
| Health | Added `/health` and retained `/api/health`; both return HTTP 200 after database/schema readiness checks pass | Ready for Render health checks |

## Changes made

Only production-readiness changes were made:

1. Added a conventional `/health` endpoint while preserving `/api/health` for compatibility.
2. Changed startup logging to include a useful redacted error message in production without printing connection URLs or credentials.
3. Changed the `start` script to use `node --experimental-strip-types server.ts`, matching the working TypeScript runtime invocation and avoiding a plain-Node `.ts` loader failure on the local Node 22 verification environment.
4. Added the non-secret [`render.yaml`](../render.yaml) Blueprint configuration.
5. Created the requested deployment documentation files.

No historical CSV, database dump, schema migration, or application workflow data was changed.

## Database and migration readiness

The application requires the existing public schema to contain these 11 tables before it starts accepting requests:

`app_users`, `clients`, `user_client_access`, `historical_tickets`, `diagnostic_checklists`, `checklist_items`, `workflow_tickets`, `investigation_check_results`, `ai_analyses`, `engineering_escalations`, and `audit_logs`.

At startup, `server.ts` performs a read-only `SELECT 1`, checks the public table inventory, and logs counts. It does not run Drizzle migrations and does not run a reset. The API router has an idempotent lazy seed/import guard that can add missing demo/reference records and import the committed historical CSV; it does not drop tables or overwrite normalized historical metrics. For a controlled production deployment, run migrations manually before the first service deploy and verify the existing database first.

Safe migration command:

```bash
npm run db:migrate
```

Run it once from a controlled environment with the production `DATABASE_URL` and `SQL_SSL=true`. Do not run `db:generate`, `db:seed`, `drizzle-kit push`, or any reset/drop command as part of Render startup. Review the migration SQL before applying it to the existing database.

## Production environment variables

The source code uses the following variables. Values are intentionally not printed here.

| Variable | Purpose | Required | Source |
|---|---|---:|---|
| `DATABASE_URL` | PostgreSQL connection URL, including the existing Render database and URL-encoded password | Yes | Render PostgreSQL connection details |
| `AUTH_SECRET` | HMAC signing key for demo bearer tokens; must be at least 32 characters | Yes | Generate and store as a Render secret |
| `GEMINI_API_KEY` | Server-side Gemini access for embedding reranking and diagnosis generation | No | Google AI Studio/API key; omit to use deterministic fallback |
| `SQL_SSL` | When `true`, adds `sslmode=require` to the parsed PostgreSQL URL | Recommended for Render PostgreSQL | Set to `true` in Render |
| `PORT` | HTTP listener port supplied by Render | No manual value | Render injects it automatically |
| `NODE_ENV` | Selects production static serving instead of Vite middleware | Yes for Render | Set to `production` |
| `NODE_VERSION` | Selects the supported Node runtime | Yes in the Blueprint | `24.12.0`, matching `package.json` engines |

The browser Firebase configuration is loaded from the committed `firebase-applet-config.json`, which contains public client configuration rather than an Admin private key. For Render, the server now supports `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` for Firebase Admin verification; the private key is converted from escaped newlines at startup. If both are omitted, the existing Application Default Credentials fallback remains available for local/GCP environments, but Google SSO should be treated as unconfigured on a generic Render service. Google SSO also requires the deployed Render hostname to be added to Firebase Authentication authorized domains.

## Verification status

| Verification | Result | Evidence or limitation |
|---|---|---|
| TypeScript/lint check | PASS | `npm run lint` completed with zero errors |
| Frontend production build | PASS | `npm run build` generated `dist` |
| Backend build | PASS by runtime model | There is no separate backend compile script; the server is TypeScript executed by Node's strip-types runtime |
| Production start command | PARTIAL | TypeScript loading passed after the start-script change; startup then reached the database probe and was blocked by sandbox networking |
| `/health` runtime response | NOT VERIFIED | Server cannot finish startup while this environment blocks the configured database connection |
| Database connectivity | NOT VERIFIED HERE | `connect EACCES ...:5432`; prior project verification records a successful Render connection, but this run cannot re-test it |
| Frontend routing through Express | STATICALLY VERIFIED | Production fallback exists; full Express response requires successful server startup |
| Authentication | NOT VERIFIED HERE | Existing test report records demo authentication success; live retest requires database access; Firebase SSO additionally requires Firebase authorized-domain setup |
| Ticket retrieval | NOT VERIFIED HERE | Requires authenticated API and database connectivity |
| Investigation/AI/escalation workflow | NOT VERIFIED HERE | Existing `TEST_REPORT.md` records prior API workflow verification; no new run was claimed |
| RBAC | NOT VERIFIED HERE | Existing test report records prior negative authorization checks; no new run was claimed |

The application should not be described as deployed until the live Render URL and all required runtime checks have been tested successfully.

## Remaining risks

- The Render service must use Node 24.12.0 or newer. The repository documents this requirement.
- The existing database must already contain the required schema, or migrations must be applied manually before deployment.
- The configured database URL must be reachable from Render and include the correct SSL mode.
- Firebase Google SSO will not work until the final Render hostname is authorized in Firebase Authentication.
- Firebase Google SSO also requires the Firebase Admin service-account values to be entered as Render secrets unless the service runs with Application Default Credentials.
- Gemini is optional. Without `GEMINI_API_KEY`, the application uses the deterministic retrieval/synthesis fallback and should be presented accordingly.
- The Vite build emits a chunk-size warning; it is not a deployment blocker for this assignment.
- The application imports its committed historical CSV from the deployed repository during lazy initialization. The CSV is versioned in `public/assets`; it must remain included in the deployment and must not be replaced by a local-only path.
