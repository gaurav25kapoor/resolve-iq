# ResolveIQ Architecture

## Overview

ResolveIQ is a unified full-stack TypeScript web application served by Express (`server.ts`) on port `3000`:
- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Recharts + Lucide icons (`src/`).
- **Backend**: Express REST API (`src/server/routes.ts`) with Zod request validation, dual authentication (`src/server/auth.ts`), server-side Gemini AI orchestration (`src/server/ai.ts`), analytics engine (`src/server/analytics.ts`), and audit trail recording (`src/server/audit.ts`).
- **Database**: PostgreSQL via Drizzle ORM (`src/db/schema.ts`, `src/db/index.ts`) and `pg.Pool` connection pooling.

---

## Data Separation: Historical vs. Live Workflow

A core architectural invariant of ResolveIQ is strict separation between RideOps' historical CSV evidence and new application activity:

1. **`historical_tickets` (Immutable Baseline)**:
   - Stores all 1,444 records from `rideops_support_tickets.csv` preserving all 20 original fields (`ticket_id`, `created_at_raw`, `channel`, `client_id`, `client_tier`, `category`, `priority`, `description`, `assigned_agent`, `escalated_to_eng`, `eng_ticket_id`, `eng_handoffs`, `eng_outcome`, `status`, `reopen_count`, `csat_score`, etc.).
   - No ResolveIQ workflow action ever overwrites historical ticket columns.
2. **`workflow_tickets`, `investigation_check_results`, `engineering_escalations`, `ai_analyses`, `audit_logs` (Live ResolveIQ Activity)**:
   - Adopting a ticket creates a linked row in `workflow_tickets`.
   - Checklist executions, L1 notes, evidence references, AI runs, and Engineering handoffs/outcomes are stored exclusively in live tables and audited in `audit_logs`.
   - Analytics endpoints (`/api/analytics/historical` vs `/api/analytics/live`) query these boundaries separately so leadership can inspect historical baseline problems alongside live process adoption without metric contamination.

---

## Backend RBAC & Validation Gates

All authorization checks run on the Express API (`requireAuth`, `requireRole`, `canAccessClient`):

- **Client-Level Access**: Every query against `historical_tickets`, `workflow_tickets`, `engineering_escalations`, `clients`, and `analytics` checks `authUser.hasGlobalClientAccess` or intersects against `user_client_access`.
- **Role Gates**:
  - `platform_admin` (Ritika): Approve/reject checklists, manage users & client scopes, view audit logs.
  - `support_manager` (Meera): Adopt tickets and assign Support Agents (`POST /api/tickets/:ticketId/adopt`, `POST /api/tickets/:ticketId/assign`). Blocked (`403`) from submitting support escalations or recording engineering outcomes.
  - `support_agent` (Arjun K / Priya D): Record checklist results, save notes/evidence, and submit escalations **only for tickets assigned to themselves**, **only when the category checklist is `approved`**, **only when all mandatory checklist items are completed**, **only when notes exist**, and **only when no active escalation is already open** (`409` duplicate protection).
  - `engineering_manager` (Sandeep): Return escalations to L1 with mandatory return reason, record documented engineering outcomes, and add comments (`POST /api/escalations/:id/review`). Blocked (`403`) from submitting support escalations.

---

## Authentication Design

- **Demo Persona Credentials**: `POST /api/auth/login` verifies `bcryptjs` password hashes stored in `app_users` and returns an HMAC-SHA256 signed bearer token (`riq.<payload>.<sig>`) held strictly in client memory (never `localStorage`).
- **Google SSO (Firebase Auth)**: `POST /api/auth/firebase` verifies Firebase ID tokens via `firebase-admin` and upserts the authenticated user into `app_users`.
