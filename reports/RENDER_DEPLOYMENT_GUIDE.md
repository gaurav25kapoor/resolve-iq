# ResolveIQ Render Deployment Guide

This guide deploys ResolveIQ as one Render Web Service. The service runs Express, serves the compiled React/Vite frontend, and exposes the API from the same origin.

## 1. Push the deployment-ready changes

Review the changed files, especially [`server.ts`](../server.ts), [`package.json`](../package.json), and [`render.yaml`](../render.yaml). Confirm that `.env`, database dumps, and other secrets are not staged.

```bash
git status
git diff -- server.ts package.json render.yaml reports/
git diff --check
npm ci
npm run lint
npm run build
git add server.ts package.json render.yaml reports/RENDER_DEPLOYMENT_GUIDE.md reports/PRODUCTION_READINESS_REPORT.md
git commit -m "Prepare ResolveIQ for Render deployment"
git push origin <your-branch>
```

Do not commit `.env`, `DATABASE_URL`, `AUTH_SECRET`, `GEMINI_API_KEY`, a Firebase Admin private key, or a database dump. The repository `.gitignore` excludes `.env*` except `.env.example` and excludes `*.dump`.

## 2. Create the Render Web Service

You can either connect the GitHub repository manually or use the included [`render.yaml`](../render.yaml) as a Blueprint.

Manual Render settings:

| Setting | Value |
|---|---|
| Service type | Web Service |
| Runtime | Node |
| Repository | The GitHub repository containing ResolveIQ |
| Root directory | Repository root; leave blank unless the repo is mounted as a subdirectory |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |
| Node version | `24.12.0` or newer; set `NODE_VERSION=24.12.0` |

Do not create a separate static site or second API service for this architecture. Do not configure a startup command that runs a reset or seed script.

## 3. Configure environment variables

Set these in Render's Environment tab. Use Render's secret storage for secret values.

| Variable | Value/source |
|---|---|
| `NODE_VERSION` | `24.12.0` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Existing Render PostgreSQL external/database connection URL; URL-encode reserved password characters and use the existing database, not a new one |
| `SQL_SSL` | `true` |
| `AUTH_SECRET` | A new random secret of at least 32 characters; do not reuse a value pasted into chat or committed to Git |
| `GEMINI_API_KEY` | Your Google AI Studio/Gemini API key, if you want live Gemini embeddings and diagnosis generation; optional |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin service-account client email for server-side Google-token verification on Render; required for Google SSO unless Render has Application Default Credentials |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin service-account private key, stored as a Render secret with escaped `\\n` line breaks; required with `FIREBASE_CLIENT_EMAIL` for Google SSO |

The browser client config comes from `firebase-applet-config.json`. In Firebase Console, add the eventual Render hostname to Authentication → Settings → Authorized domains. Confirm Google sign-in is enabled for the Firebase project. Do not upload a Firebase service-account JSON file to the repository.

Render supplies `PORT`; do not hardcode a public port. The application listens on `0.0.0.0`.

## 4. Apply or verify database migrations

Before the first production deploy, inspect the existing database and confirm it is the ResolveIQ database. Take a backup according to your normal database procedure. Do not reset, recreate, drop, or overwrite it.

If the required tables are already present, no migration is needed. If the committed migrations have not been applied, run this exact command from a controlled machine with the production variables loaded:

```bash
SQL_SSL=true npm run db:migrate
```

On PowerShell, set the variables in the session before running the command:

```powershell
$env:DATABASE_URL = '<existing Render PostgreSQL URL>'
$env:SQL_SSL = 'true'
npm run db:migrate
```

Do not put the real URL in a script or commit it. Do not use `drizzle-kit push`, `db:seed`, or a reset command against the production database. The service performs a read-only startup table check; it does not apply migrations automatically.

## 5. Deploy

1. Create the service or select **Blueprint** and point Render at `render.yaml`.
2. Add the environment variables above, using secret values where applicable.
3. Confirm the existing PostgreSQL connection and schema before deploying.
4. Start the first deploy.
5. Wait for the build command to complete and for the health check at `/health` to pass.

The expected startup log includes a schema/readiness confirmation and a line stating that ResolveIQ is listening on `0.0.0.0:<Render port>`. It must not print a database URL or API key.

## 6. Inspect Render logs

In the Render service dashboard, check:

- Build logs: `npm ci` succeeds and `vite build` produces `dist`.
- Runtime logs: the Node process starts with `npm start` and does not report missing `DATABASE_URL`, `AUTH_SECRET`, tables, or the historical CSV.
- Health checks: `/health` returns HTTP 200.
- Database errors: if startup fails, verify the URL, SSL mode, IP/connection policy, and required tables. Do not respond by running a reset or seed command.
- Firebase errors: verify the Render hostname is an authorized Firebase domain and that Google SSO is enabled.

## 7. Test the live application

Replace `<render-url>` with the actual HTTPS URL. Do not mark the deployment complete until these checks have been run against that URL.

```bash
curl -i https://<render-url>/health
curl -i https://<render-url>/api/health
curl -i https://<render-url>/
```

Expected results:

- `/health`: HTTP 200 JSON with `ok: true`.
- `/api/health`: HTTP 200 JSON with `ok: true`.
- `/`: HTTP 200 containing the ResolveIQ SPA.

Then test in the browser:

1. Open the HTTPS Render URL and confirm the login page loads without console/network errors.
2. Use a demo credential configured in the existing database, or the approved authentication path. Do not publish demo passwords in a public README unless that is intentional for the take-home submission.
3. Confirm the Overview page loads.
4. Confirm Ticket Inbox returns tickets and a ticket detail opens.
5. Confirm a Support Manager can adopt/assign a ticket and a Support Agent sees only permitted work.
6. Confirm an eligible agent can complete an approved checklist, save notes/evidence, and submit an escalation.
7. Confirm Engineering can review or return the escalation and that RBAC blocks unauthorized actions.
8. Confirm the AI Assistant returns either Gemini-backed results or the clearly identified deterministic fallback. Never treat the fallback as Gemini output.
9. Confirm Google SSO only after Firebase authorized-domain setup and Firebase Admin secret configuration; otherwise record it as pending.
10. Test a mobile viewport and a desktop viewport, including the SPA fallback after a direct route refresh.

Record the date, URL, account/role used, and result of each check. Do not record passwords, bearer tokens, database URLs, or Gemini keys.

## 8. Manual actions still required from you

Deployment cannot be completed by this workspace because it does not have access to your GitHub account, Render dashboard, Firebase Console, or a permitted connection to the existing Render PostgreSQL service. You must:

- push the reviewed changes to GitHub;
- create/connect the Render Web Service;
- enter the secret environment-variable values;
- verify or safely apply the existing migrations;
- authorize the final Render hostname in Firebase;
- run the live tests above and share the public URL if you want a second verification pass.

No public Render URL is claimed by this report.
