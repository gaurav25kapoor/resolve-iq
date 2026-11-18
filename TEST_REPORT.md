# ResolveIQ Verification & Test Report

## Current Local Verification (2026-11-18)

Render target: `dpg-dbuefdk9v7es738ap31g-a.oregon-postgres.render.com/resolveiq_db_dr9e`. Passwords and the connection URL were not logged.

| Check | Result |
| :--- | :--- |
| Pre-reset backup | **PASS** — `resolveiq-pre-reset-20261118.dump`, 339,084 bytes; `pg_restore --list` readable, archived database identity matched, SHA-256 `19341af959f9cf0062bf80a90a7e75dcb7cb9abf0261faff59c2e4c1a7e090f0`. |
| Public schema reset | **PASS** — transaction verified exact prior table inventory, dropped 25 public tables and dependent objects, and left the database and system schemas intact. |
| Drizzle migrations | **PASS** — applied `drizzle/0000_wealthy_supernaut.sql` and additive `drizzle/0001_organic_vector.sql`, which adds the exact CSV field snapshot and ticket/client FK without dropping data. |
| ResolveIQ schema | **PASS** — all 11 expected public tables; 20/20 foreign keys validated; all 23 indexes valid and ready; two migration ledger entries. |
| Seed and idempotency | **PASS** — two seed runs retained 1,444 historical tickets, 191 clients, 5 demo users, 10 checklists, and 27 checklist items without adding workflow rows. |
| Historical CSV import verification | **PASS** — full SQL suite compared the CSV against the database after both seed runs; results and query excerpts are below. |
| `npm install` | **PASS** on Node.js 22.17.0 / npm 10.9.2, with engine warnings because Firebase 13 requires Node.js >=24.12.0. Node.js 24.12.0 is the documented supported runtime. |
| `npm run lint` | **PASS** (`tsc --noEmit`, 0 errors). |
| `npm run build` | **PASS** (Vite 8 production bundle generated). |
| Source ZIP | **PASS** — `resolveiq-source.zip` has 54 entries and excludes `.env`, the database dump, `node_modules`, and `dist`; it includes `.env.example`, both Drizzle migrations, and the SQL verification suite. |
| Backend startup and PostgreSQL | **PASS** — latest server connected to PostgreSQL, verified 11 tables and expected record counts, and listened on port 3000. `GET /api/health` returned `ok: true`. |
| Local frontend response | **PASS** — `GET /` returned HTTP 200 and the ResolveIQ SPA. No interactive browser automation was available in this environment. |
| Demo authentication | **PASS** — Ritika, Meera, Sandeep, Arjun, and Priya all authenticated via the demo login endpoint. |
| End-to-end workflow | **PASS** — workflow was exercised earlier. Its synthetic ticket-specific workflow, escalation, AI analysis, and nine ticket-linked audit entries were removed afterward; the test left zero workflow records or ticket-linked audit events. |
| Backend authorization | **PASS** — unauthorized checklist decision and manager escalation attempts returned 403; Priya’s direct access to an out-of-scope ticket returned 403. |
| Historical data integrity | **PASS** — historical CSV table remains at 1,444 rows and 191 clients; exact raw source fields match the CSV. No test investigations, assignments, escalations, or ticket-linked audit events remain. |
| Historical analytics API | **PASS** — returned 1,444 tickets, 191 clients, 486 escalations, 48 open snapshot tickets, and monthly arrivals `390 / 462 / 592`. |
| Final restart attempt in this tool session | **BLOCKED** — `npm.cmd run dev` reached the server bootstrap, but PostgreSQL TCP connection to `35.227.164.209:5432` returned `EACCES` in the current restricted network environment. Earlier startup/health checks in this report passed; this later restart could not be re-verified here. |

The retained backup is intentionally excluded from Git and source ZIP exports.

### Historical import SQL checks

The reproducible read-only suite is [verify-historical-import.sql](scripts/verify-historical-import.sql), run with `npm run db:verify-history`. It stages the original CSV with `\copy`, compares every decoded CSV cell with `historical_tickets.source_fields`, checks normalized values and relationships, and compares analytics groupings. Key queries from that executed suite:

```sql
SELECT count(*) AS historical_tickets,
       count(DISTINCT client_id) AS distinct_clients
FROM public.historical_tickets;

SELECT count(*) AS raw_source_field_mismatches
FROM csv_source s
FULL OUTER JOIN public.historical_tickets h USING (ticket_id)
WHERE s.ticket_id IS NULL OR h.ticket_id IS NULL
   OR h.source_fields IS DISTINCT FROM to_jsonb(s);

SELECT count(*) AS orphaned_client_references
FROM public.historical_tickets h
LEFT JOIN public.clients c ON c.client_id = h.client_id
WHERE c.client_id IS NULL;

SELECT count(*) AS duplicate_csv_ticket_ids
FROM (SELECT ticket_id FROM csv_source GROUP BY ticket_id HAVING count(*) > 1) d;
```

Actual results after the first and second import were identical:

| Verification | Actual result |
| :--- | :--- |
| CSV rows / historical ticket rows | `1444 / 1444` |
| CSV distinct clients / historical distinct clients | `191 / 191` |
| Duplicate CSV IDs / duplicate database IDs | `0 / 0` |
| CSV rows missing in DB / DB rows absent from CSV | `0 / 0` |
| Exact raw source field mismatches | `0`; all `1444` rows have exactly 20 source fields |
| Orphaned client references | `0`; the historical client FK is validated |
| Total public FKs / validated | `20 / 20` |
| Total public indexes / valid | `23 / 23` |
| Normalized boolean, numeric, timestamp-text, and derived resolution/response mismatches | `0` |
| Monthly arrivals CSV = database | `2026-07: 390`, `2026-08: 462`, `2026-09: 592` |
| CSV vs DB analytics summary | `1,444` tickets; `191` clients; `486` escalated; `48` open snapshot (`29` L1, `19` Engineering); `648` rated CSAT, mean `3.70`; mean resolution `99.79h` escalated / `19.96h` non-escalated |
| Historical analytics dimension mismatches / derived field mismatches | `0 / 0` |
| Workflow tickets / checklist results / escalations / AI analyses / ticket-linked audit events | `0 / 0 / 0 / 0 / 0` |

## Archived Verification from the Earlier Cloud SQL Environment

The following historical report predates the Render reset and is retained for reference only.

**Environment**: Node.js v22.23.2 · Express + Vite SPA (`http://localhost:3000`) · Cloud SQL PostgreSQL (`asia-southeast1`) · Drizzle ORM  
**Date**: Verified against seeded PostgreSQL instance (`1,444` historical tickets, `191` clients, `5` demo personas, `10` proposed demonstration checklists / `27` checklist items).

---

## 1. Build & Static Type Checks

| Check | Command | Result |
| :--- | :--- | :--- |
| Drizzle Schema Push | `cloudsql.UpdateSchema` + `information_schema.columns` | **PASS** — 11 tables verified |
| CSV Data Ingestion & Seed | `npx tsx src/db/seed.ts` | **PASS** — 1,444 tickets, 191 clients, 5 users, 10 checklists |
| TypeScript Check | `npm run lint` (`tsc --noEmit`) | **PASS** — 0 errors |
| Production Bundle | `npm run build` (`vite build`) | **PASS** — compiled cleanly |

---

## 2. End-to-End Functional & RBAC Integration Suite

Executed live against Express + Cloud SQL on `http://localhost:3000`:

1. **Authentication (5 Personas)**:
   - Authenticated `ritika@rideops.io` (`platform_admin`), `meera@rideops.io` (`support_manager`), `sandeep@rideops.io` (`engineering_manager`), `arjun@rideops.io` (`support_agent`), and `priya@rideops.io` (`support_agent`, scoped) via `POST /api/auth/login`. **PASS**
2. **Historical Analytics Accuracy (`GET /api/analytics/historical`)**:
   - Verified `1,444` total tickets, `48` Sep 30 open-snapshot tickets (`29` L1, `19` Engineering), `486` escalated tickets (`33.7%`), and `648` rated CSAT entries (`44.9%` coverage, blanks excluded). **PASS**
3. **Backend RBAC Negative Enforcement**:
   - `arjun@rideops.io` (`support_agent`) attempting `POST /api/checklists/3/decision` → **`403 Forbidden`**. **PASS**
   - `meera@rideops.io` (`support_manager`) attempting `POST /api/escalations` → **`403 Forbidden`**. **PASS**
   - `sandeep@rideops.io` (`engineering_manager`) attempting `POST /api/escalations` → **`403 Forbidden`**. **PASS**
4. **Client-Level Access Enforcement**:
   - `priya@rideops.io` scoped to `25` clients; ticket inbox total restricted accordingly; direct access to out-of-scope ticket `SUP-11444` → **`403 Forbidden`**. **PASS**
5. **Checklist Governance (`Ritika`)**:
   - Approved `"Report export failing"` proposed demonstration checklist (`POST /api/checklists/:id/decision`) and logged audit entry. **PASS**
6. **Ticket Adoption & Assignment (`Meera`)**:
   - Adopted `SUP-11442` and `SUP-11419` into `workflow_tickets` (`POST /api/tickets/:ticketId/adopt`) without mutating `historical_tickets`, and assigned via agent dropdown (`POST /api/tickets/:ticketId/assign`) to Arjun Kulkarni. **PASS**
7. **Investigation, Checklist Execution, Notes & AI Assistant (`Arjun`)**:
   - Verified `GET /api/investigations?mine=true` lists assigned tickets.
   - Saved checklist results (`pass` / `fail`) with step notes and evidence refs (`PUT /api/investigations/:ticketId/checklist`).
   - Saved investigation notes & structured evidence (`PUT /api/investigations/:ticketId/notes`).
   - Queried AI Investigation Assistant (`POST /api/ai/investigate/:ticketId`) → returned 6 similar historical tickets using **`gemini-embedding-2 + tfidf-prefilter`** + grounded diagnosis + draft handoff. **PASS**
8. **Escalation Gatekeeping & Duplicate Prevention (`Arjun`)**:
   - Submitted structured escalation on `SUP-11442` (`201 Created`).
   - Re-submitted duplicate escalation while active → **`409 Conflict`**. **PASS**
9. **Engineering Review, Return-to-L1 & Re-Escalation (`Sandeep` ↔ `Arjun`)**:
   - `Sandeep` reviewed `SUP-11442` (`POST /api/escalations/:id/review`) and recorded outcome **`Fixed`**.
   - `Sandeep` returned `SUP-11419` (`return_to_l1` with mandatory return reason `Insufficient info - returned to L1`); `Arjun` re-submitted handoff `#2` (`handoffNumber: 2`). **PASS**
10. **Live Analytics, Audit Trail & Source ZIP Export**:
    - Verified `GET /api/analytics/live` reflects live adoptions, checklist completions, returns, and recorded outcomes separately from historical CSV metrics.
    - Verified `GET /api/admin/audit-logs` captures all actions with actor, role, entity, and timestamp.
    - Verified `GET /api/export/source-zip` streams clean 210,990-byte archive excluding `.env`, `node_modules`, and `dist`. **PASS**
