# ResolveIQ — Support Investigation & Engineering Escalation Intelligence

**ResolveIQ transforms support tickets into structured investigations and evidence-backed engineering handoffs, helping teams identify recurring issues and improve escalation quality.**

Built for **RideOps** (employee transportation SaaS), ResolveIQ bridges L1 Support, Engineering, and Operations leadership around a single auditable PostgreSQL workflow while keeping the 1,444-record historical dataset (`Jul 2 – Sep 30, 2026`) strictly immutable and analytically separated from live application activity.

---

## Key Capabilities

1. **Historical Operational Diagnostics (`Jul–Sep 2026`)**:
   - Full ingestion of all 1,444 tickets across 191 corporate clients (`rideops_support_tickets.csv`).
   - Verified metrics on arrival volume (`390 → 462 → 592`), single Sep 30 open snapshot (`48` tickets), escalation rate (`33.7%` / `486` escalated), engineering return reasons (`18.3%` insufficient info, `17.3%` configuration issues), resolution time distributions (`19.96h` mean non-escalated vs `99.79h` mean escalated), and CSAT coverage (`44.9%`, `3.70` average excluding missing scores).
2. **Operations-Approved Diagnostic Checklists**:
   - Category-specific checklists explicitly labeled as **Proposed Demonstration Checklists (Requires Operations Approval)** until approved by Platform Admin (Ritika).
3. **Structured L1 Investigation & Escalation Gatekeeping**:
   - Support Lead (Meera) adopts historical tickets into live ResolveIQ workflows and assigns them via agent dropdown.
   - Support Agents execute approved checks (`Pass / Fail / N/A`), attach notes & evidence references, and submit structured handoffs only when backend validation gates pass.
4. **AI Investigation Assistant (`@google/genai` + Semantic Similarity)**:
   - Retrieves semantically similar historical tickets using `gemini-embedding-2` (with deterministic TF-IDF bigram cosine similarity fallback when no API key is configured).
   - Generates grounded diagnosis summaries, AI-recommended (not yet completed) steps, explicit uncertainty disclosures, and draft engineering handoff fields using `gemini-4-hydrogen` (or deterministic synthesis fallback).
5. **Engineering Handoff Review & Outcome Tracking**:
   - Engineering Manager (Sandeep) inspects verified checklists, evidence, and notes; returns incomplete handoffs with mandatory return reasons; or records documented engineering outcomes.
6. **Strict Backend RBAC & Client-Level Scoping**:
   - Every role constraint and client-access boundary is enforced server-side on Express API routes with full audit logging.

---

## Demo Personas & Credentials

All demo accounts share the documented demo password: **`ResolveIQ!2026`** (also available via one-click entry buttons on the login screen, alongside Google SSO).

| Persona | Email | Role | Access Scope & Capabilities |
| :--- | :--- | :--- | :--- |
| **Ritika Sharma** | `ritika@rideops.io` | `platform_admin` (Head of Operations) | Global analytics, user & client-access management, approve/reject diagnostic checklists, audit logs |
| **Meera Nair** | `meera@rideops.io` | `support_manager` (Support Lead) | Adopt tickets, assign Support Agents, monitor investigations & escalation quality (cannot submit support escalations) |
| **Sandeep Verma** | `sandeep@rideops.io` | `engineering_manager` (Engineering User) | Inspect engineering handoffs, return incomplete escalations with reason, record documented outcomes, add notes (cannot submit support escalations) |
| **Arjun Kulkarni** | `arjun@rideops.io` | `support_agent` (Senior Support Agent) | Global client scope; investigate assigned tickets, run approved checklists, query AI Assistant, submit eligible escalations |
| **Priya Deshmukh** | `priya@rideops.io` | `support_agent` (Scoped Accounts) | Restricted to 25 assigned clients to demonstrate server-side client-level access enforcement |

---

## Local Setup & Running

### Prerequisites
- Windows 11, PowerShell, and Node.js **24.12.0 or newer**. Firebase 13 / Firebase Admin 14 in this lockfile require Node 24.12; Vite 8 also requires a recent Node release.
- npm 10 or newer.
- An existing PostgreSQL database with the ResolveIQ schema. Render PostgreSQL is supported with SSL.

### Environment Variables
Copy `.env.example` to `.env` and configure `DATABASE_URL`, `AUTH_SECRET` (random, at least 32 characters), and optionally `GEMINI_API_KEY`. Use a Render PostgreSQL URL with `?sslmode=require`; URL-encode reserved characters in its password. `.env` is Git-ignored and excluded from source ZIP exports.

On startup, the app connects to PostgreSQL, verifies that the 11 existing public tables are present, and logs non-secret table and record counts. Database credentials and the complete connection URL are never logged.

### Database & Seed
```powershell
Copy-Item .env.example .env
# Edit .env and set DATABASE_URL and AUTH_SECRET before starting.
npm install
npm run db:migrate
npm run db:seed
```

The committed Drizzle migrations create the 11 ResolveIQ application tables, preserve all 20 decoded CSV fields in each historical ticket’s `source_fields` JSONB snapshot, and enforce the historical ticket-to-client foreign key. The seed is idempotent: it inserts missing clients/tickets, and on ticket conflicts updates only the raw-source snapshot while leaving normalized historical metrics untouched. It does not create workflow, investigation, assignment, escalation, AI-analysis, or ticket audit rows for historical data. It also adds missing demo personas and proposed checklists. Back up and review schema changes before applying migrations to any database containing records; do not use `drizzle-kit push` against an existing database without reviewing its proposed changes.

To compare the historical database records and analytics to the original CSV, run `npm run db:verify-history`. This read-only check requires PostgreSQL client tools (`psql`) on `PATH` and reports row counts, exact source-field mismatches, client orphans, duplicates, and analytics grouping differences.

### Development & Production
```bash
# Development (Express + Vite middleware at http://localhost:3000)
npm run dev

# Production build & start (PowerShell)
npm run build
$env:NODE_ENV="production"
npm start
```

### Render PostgreSQL Deployment Notes
When deploying to Render, set `DATABASE_URL` to the Render PostgreSQL URL with `sslmode=require` and configure `AUTH_SECRET` in the service environment. Build with `npm run build` and start with `npm start`. Schema migration is intentionally not part of startup; inspect and back up the existing database before any schema changes.
