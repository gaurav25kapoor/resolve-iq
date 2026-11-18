import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { count, eq, sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db } from './index.ts';
import {
  appUsers,
  checklistItems,
  clients,
  diagnosticChecklists,
  historicalTickets,
  userClientAccess,
} from './schema.ts';

const CSV_RELATIVE_PATH = 'public/assets/aistudio/rideops_support_tickets_00617967.csv';

interface RawCsvTicket {
  ticket_id: string;
  created_at: string;
  channel: string;
  client_id: string;
  client_name: string;
  client_tier: string;
  category: string;
  priority: string;
  description: string;
  assigned_agent: string;
  first_response_at: string;
  escalated_to_eng: string;
  eng_ticket_id: string;
  eng_handoffs: string;
  eng_outcome: string;
  status: string;
  first_closed_at: string;
  final_closed_at: string;
  reopen_count: string;
  csat_score: string;
}

function parseTimestamp(raw: string | undefined): Date | null {
  if (!raw || !raw.trim()) return null;
  // CSV timestamps are IST ("YYYY-MM-DD HH:mm"). Store consistently in UTC offset +05:30.
  const normalized = raw.trim().replace(' ', 'T') + ':00+05:30';
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

interface ChecklistSeedDef {
  category: string;
  title: string;
  description: string;
  initialStatus: 'pending_approval' | 'approved';
  items: Array<{
    label: string;
    guidance: string;
    isMandatory: boolean;
    allowFailEscalation: boolean;
  }>;
}

const PROPOSED_CHECKLIST_SEEDS: ChecklistSeedDef[] = [
  {
    category: 'Live tracking / GPS incorrect',
    title: 'Proposed Demonstration Checklist — Live Tracking & GPS Telemetry',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to separate device/network telemetry gaps from platform map rendering defects.',
    initialStatus: 'pending_approval',
    items: [
      {
        label: 'Verify driver app version & GPS permission status',
        guidance:
          'Confirm driver mobile build is on supported version and background location + high-accuracy GPS permissions are enabled.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Check last telemetry ping timestamp & trip state',
        guidance:
          'Inspect trip telemetry log for last heartbeat interval, network drop windows, and active trip ID binding.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Test tracking URL in incognito / secondary browser',
        guidance:
          'Verify whether tracking link issue is client browser/corporate firewall related or affecting telemetry API.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Capture screenshot, trip ID, and timestamp window (IST)',
        guidance:
          'Attach trip ID, vehicle ID, and 15-minute telemetry payload excerpt before escalating to engineering.',
        isMandatory: true,
        allowFailEscalation: false,
      },
    ],
  },
  {
    category: 'Roster / booking not syncing',
    title: 'Proposed Demonstration Checklist — Roster & Shift Booking Sync',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to distinguish client cutoff/policy configuration from sync job failures.',
    initialStatus: 'pending_approval',
    items: [
      {
        label: 'Verify client shift cutoff rules & booking policy config',
        guidance:
          'Check client admin portal for shift booking cutoff lead times, auto-approval toggles, and recent policy edits.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Validate employee ID, shift slot, and roster batch status',
        guidance:
          'Confirm employee active status, assigned home/office site, and whether roster generation batch ran after booking timestamp.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Check sync job audit / webhook queue errors',
        guidance:
          'Inspect HRMS/booking sync execution log for validation rejections vs unhandled API errors.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Attach affected employee IDs, shift date, and sync job ID',
        guidance:
          'Provide at least 2 concrete employee/booking IDs and expected vs observed roster state.',
        isMandatory: true,
        allowFailEscalation: false,
      },
    ],
  },
  {
    category: 'Report export failing',
    title: 'Proposed Demonstration Checklist — Billing & Ops Report Export',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to isolate date-range timeouts, filter mismatches, and export renderer errors.',
    initialStatus: 'pending_approval',
    items: [
      {
        label: 'Confirm selected date range, filters, and report template',
        guidance:
          'Check whether export covers >90 days or high row volume and test a narrower 7-day range.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Check browser console / HTTP status or background job ID',
        guidance:
          'Record exact HTTP error code (e.g. 504 timeout vs 403 permission) or failed async export job ID.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Verify user role export permissions for requested site/client',
        guidance:
          'Ensure requester role has report export rights and selected client scope is active.',
        isMandatory: true,
        allowFailEscalation: true,
      },
    ],
  },
  {
    category: 'OTP / boarding issue',
    title: 'Proposed Demonstration Checklist — Boarding OTP & Trip Start',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to verify SMS gateway delivery, clock skew, and employee phone registration.',
    initialStatus: 'approved',
    items: [
      {
        label: 'Confirm employee registered mobile number & DND status',
        guidance:
          'Verify phone number formatting (+91 / E.164) and check SMS delivery receipt in notification log.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Verify driver app boarding flow & trip status',
        guidance:
          'Confirm trip was in Arrived state when OTP was entered and check for stale OTP retry lockouts.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Attach trip ID, SMS gateway trace ID, and timestamp',
        guidance:
          'Document exact boarding failure message shown to driver/employee.',
        isMandatory: true,
        allowFailEscalation: false,
      },
    ],
  },
  {
    category: 'Billing / invoice discrepancy',
    title: 'Proposed Demonstration Checklist — Vendor & Client Billing Reconciliation',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to validate rate card versions, distance overrides, and invoice line items.',
    initialStatus: 'approved',
    items: [
      {
        label: 'Compare applied rate card effective dates with trip dates',
        guidance:
          'Check client/vendor rate card effective_from timestamp and slab rules.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Audit sample disputed trip IDs for GPS vs manual distance',
        guidance:
          'Collect 3 disputed trip IDs showing billed amount vs expected calculation.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Confirm invoice cycle adjustment / credit note history',
        guidance:
          'Verify whether manual adjustments were applied after invoice draft generation.',
        isMandatory: true,
        allowFailEscalation: false,
      },
    ],
  },
  {
    category: 'Employee address / geocode change',
    title: 'Proposed Demonstration Checklist — Employee Geocode & Nodal Point Validation',
    description:
      'Proposed diagnostic sequence (requires Operations approval) for address updates, geofence boundaries, and routing eligibility.',
    initialStatus: 'approved',
    items: [
      {
        label: 'Verify latitude/longitude pin & service zone geofence',
        guidance:
          'Check employee address coordinates against active client service polygon and nodal rules.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Confirm effective date for upcoming roster vs active trip',
        guidance:
          'Geocode changes apply to future rosters; confirm whether change occurred after roster lock.',
        isMandatory: true,
        allowFailEscalation: true,
      },
    ],
  },
  {
    category: 'How-to / feature request',
    title: 'Proposed Demonstration Checklist — Feature Guidance & Configuration Check',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to confirm existing product capability before routing as enhancement.',
    initialStatus: 'approved',
    items: [
      {
        label: 'Check existing admin configuration & KB documentation',
        guidance:
          'Confirm whether requested workflow is already supported via client config flags.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Document requested workflow & client business justification',
        guidance:
          'Capture exact user persona, expected benefit, and workaround if applicable.',
        isMandatory: true,
        allowFailEscalation: false,
      },
    ],
  },
  {
    category: 'Cab delay / no-show complaint',
    title: 'Proposed Demonstration Checklist — Dispatch Delay & No-Show Audit',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to verify vendor dispatch log, ETA alerts, and driver check-in.',
    initialStatus: 'approved',
    items: [
      {
        label: 'Inspect vendor dispatch timestamp & driver acceptance log',
        guidance:
          'Check when trip was allocated to vendor/driver and whether backup cab auto-dispatch triggered.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Check SMS/push ETA notification delivery to employee',
        guidance:
          'Confirm trip delay alerts and driver contact masking functioned properly.',
        isMandatory: true,
        allowFailEscalation: true,
      },
    ],
  },
  {
    category: 'Login / access issue',
    title: 'Proposed Demonstration Checklist — SSO, RBAC & Account Access',
    description:
      'Proposed diagnostic sequence (requires Operations approval) to resolve role assignments, SSO mapping, and password/MFA lockouts.',
    initialStatus: 'approved',
    items: [
      {
        label: 'Verify user account active status & assigned RBAC role',
        guidance:
          'Check user provisioning record, email domain match, and module permissions.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Check SSO SAML/OAuth callback error or session expiry',
        guidance:
          'Record IdP error code or screenshot if corporate SSO login fails.',
        isMandatory: true,
        allowFailEscalation: true,
      },
    ],
  },
  {
    category: 'Driver / vehicle compliance docs',
    title: 'Proposed Demonstration Checklist — Driver & Vehicle Document Verification',
    description:
      'Proposed diagnostic sequence (requires Operations approval) for document expiry alerts, upload failures, and compliance locks.',
    initialStatus: 'approved',
    items: [
      {
        label: 'Verify document expiry dates & file format constraints',
        guidance:
          'Check PDF/JPG file size (<5MB) and expiry date field formatting in compliance portal.',
        isMandatory: true,
        allowFailEscalation: true,
      },
      {
        label: 'Confirm compliance block rule vs portal upload error',
        guidance:
          'Distinguish expected dispatch lock from upload API failure.',
        isMandatory: true,
        allowFailEscalation: true,
      },
    ],
  },
];

let seedPromise: Promise<void> | null = null;
let seededConfirmed = false;

export async function seedDatabase(): Promise<void> {
  // 1. Seed Demo Personas (idempotent)
  const demoPasswordHash = await bcrypt.hash('ResolveIQ!2026', 10);

  const personaDefs = [
    {
      email: 'ritika@rideops.io',
      name: 'Ritika Sharma',
      designation: 'Head of Operations',
      role: 'platform_admin',
      agentAlias: null,
      hasGlobalClientAccess: true,
    },
    {
      email: 'meera@rideops.io',
      name: 'Meera Nair',
      designation: 'Support Lead',
      role: 'support_manager',
      agentAlias: null,
      hasGlobalClientAccess: true,
    },
    {
      email: 'sandeep@rideops.io',
      name: 'Sandeep Verma',
      designation: 'Engineering Manager',
      role: 'engineering_manager',
      agentAlias: null,
      hasGlobalClientAccess: true,
    },
    {
      email: 'arjun@rideops.io',
      name: 'Arjun Kulkarni',
      designation: 'Senior Support Agent',
      role: 'support_agent',
      agentAlias: 'Arjun K',
      hasGlobalClientAccess: true,
    },
    {
      email: 'priya@rideops.io',
      name: 'Priya Deshmukh',
      designation: 'Support Agent (Scoped Accounts)',
      role: 'support_agent',
      agentAlias: 'Priya D',
      hasGlobalClientAccess: false,
    },
  ];

  const userByEmail = new Map<string, number>();

  for (const persona of personaDefs) {
    const existing = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, persona.email))
      .limit(1);

    if (existing[0]) {
      userByEmail.set(persona.email, existing[0].id);
    } else {
      const inserted = await db
        .insert(appUsers)
        .values({
          email: persona.email,
          name: persona.name,
          designation: persona.designation,
          role: persona.role,
          agentAlias: persona.agentAlias,
          passwordHash: demoPasswordHash,
          hasGlobalClientAccess: persona.hasGlobalClientAccess,
          isActive: true,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted[0]) {
        userByEmail.set(persona.email, inserted[0].id);
      }
    }
  }

  // 2. Import CSV Historical Tickets & Clients (idempotent)
  const csvPath = path.resolve(process.cwd(), CSV_RELATIVE_PATH);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Historical CSV dataset not found at ${csvPath}`);
  }
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as RawCsvTicket[];
  if (records.length !== 1444 || new Set(records.map((r) => r.ticket_id)).size !== 1444) {
    throw new Error('Historical source CSV must contain exactly 1,444 unique ticket records.');
  }
  if (new Set(records.map((r) => r.client_id)).size !== 191) {
    throw new Error('Historical source CSV must contain exactly 191 distinct corporate clients.');
  }

  // Deduplicate clients
  const clientMap = new Map<
    string,
    { clientId: string; clientName: string; clientTier: string; slaTargetHours: number }
  >();

  for (const r of records) {
    if (!clientMap.has(r.client_id)) {
      const sla =
        r.client_tier === 'Enterprise' ? 12 : r.client_tier === 'Mid-market' ? 24 : 48;
      clientMap.set(r.client_id, {
        clientId: r.client_id,
        clientName: r.client_name,
        clientTier: r.client_tier,
        slaTargetHours: sla,
      });
    }
  }

  const clientRows = Array.from(clientMap.values());
  for (let i = 0; i < clientRows.length; i += 100) {
    await db
      .insert(clients)
      .values(clientRows.slice(i, i + 100))
      .onConflictDoNothing();
  }

  const ticketRows = records.map((r) => {
      const createdAtTs = parseTimestamp(r.created_at) ?? new Date();
      const firstResponseAtTs = parseTimestamp(r.first_response_at);
      const firstClosedAtTs = parseTimestamp(r.first_closed_at);
      const finalClosedAtTs = parseTimestamp(r.final_closed_at);

      const resolutionHours =
        finalClosedAtTs !== null
          ? Math.max(
              0,
              Math.round(
                ((finalClosedAtTs.getTime() - createdAtTs.getTime()) / (1000 * 60 * 60)) *
                  100
              ) / 100
            )
          : null;

      const firstResponseMinutes =
        firstResponseAtTs !== null
          ? Math.max(
              0,
              Math.round(
                ((firstResponseAtTs.getTime() - createdAtTs.getTime()) / (1000 * 60)) * 10
              ) / 10
            )
          : null;

      const csatVal =
        r.csat_score && r.csat_score.trim() !== '' ? Number(r.csat_score.trim()) : null;

      const escalatedBool = r.escalated_to_eng.trim().toLowerCase() === 'yes';

      return {
        ticketId: r.ticket_id,
        createdAtRaw: r.created_at,
        createdAtTs,
        channel: r.channel,
        clientId: r.client_id,
        clientName: r.client_name,
        clientTier: r.client_tier,
        category: r.category,
        priority: r.priority,
        description: r.description,
        assignedAgent: r.assigned_agent,
        firstResponseAtRaw: r.first_response_at || null,
        firstResponseAtTs,
        escalatedToEng: escalatedBool,
        engTicketId: r.eng_ticket_id || null,
        engHandoffs: Number(r.eng_handoffs || 0),
        engOutcome: r.eng_outcome || null,
        status: r.status,
        firstClosedAtRaw: r.first_closed_at || null,
        firstClosedAtTs,
        finalClosedAtRaw: r.final_closed_at || null,
        finalClosedAtTs,
        reopenCount: Number(r.reopen_count || 0),
        csatScore: csatVal !== null && !Number.isNaN(csatVal) ? csatVal : null,
        resolutionHours,
        firstResponseMinutes,
        searchText: `${r.category} ${r.priority} ${r.client_tier} ${r.description} ${r.eng_outcome || ''}`.toLowerCase(),
        embeddingJson: null,
        sourceFields: {
          ticket_id: r.ticket_id,
          created_at: r.created_at,
          channel: r.channel,
          client_id: r.client_id,
          client_name: r.client_name,
          client_tier: r.client_tier,
          category: r.category,
          priority: r.priority,
          description: r.description,
          assigned_agent: r.assigned_agent,
          first_response_at: r.first_response_at,
          escalated_to_eng: r.escalated_to_eng,
          eng_ticket_id: r.eng_ticket_id,
          eng_handoffs: r.eng_handoffs,
          eng_outcome: r.eng_outcome,
          status: r.status,
          first_closed_at: r.first_closed_at,
          final_closed_at: r.final_closed_at,
          reopen_count: r.reopen_count,
          csat_score: r.csat_score,
        },
      };
  });

  for (let i = 0; i < ticketRows.length; i += 200) {
    await db
      .insert(historicalTickets)
      .values(ticketRows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: historicalTickets.ticketId,
        // Only enrich the raw-source snapshot; never replace existing historical metrics.
        set: { sourceFields: sql`excluded.source_fields` },
      });
  }

  // 3. Seed scoped client access for Priya D (first 25 Mid-market/SMB clients) so client RBAC is real
  const priyaId = userByEmail.get('priya@rideops.io');
  const ritikaId = userByEmail.get('ritika@rideops.io');
  if (priyaId) {
    const existingScope = await db
      .select({ value: count() })
      .from(userClientAccess)
      .where(eq(userClientAccess.userId, priyaId));
    if (Number(existingScope[0]?.value ?? 0) === 0) {
      const sampleClients = await db.select().from(clients).limit(25);
      if (sampleClients.length > 0) {
        await db
          .insert(userClientAccess)
          .values(
            sampleClients.map((c) => ({
              userId: priyaId,
              clientId: c.clientId,
              grantedByUserId: ritikaId ?? null,
            }))
          )
          .onConflictDoNothing();
      }
    }
  }

  // 4. Seed 10 Proposed Demonstration Checklists (idempotent)
  for (const def of PROPOSED_CHECKLIST_SEEDS) {
    const existing = await db
      .select()
      .from(diagnosticChecklists)
      .where(eq(diagnosticChecklists.category, def.category))
      .limit(1);

    if (existing[0]) continue;

    const inserted = await db
      .insert(diagnosticChecklists)
      .values({
        category: def.category,
        title: def.title,
        description: def.description,
        isProposedDemo: true,
        status: def.initialStatus,
        version: 1,
        approvedByUserId: def.initialStatus === 'approved' ? (ritikaId ?? null) : null,
        approvalNotes:
          def.initialStatus === 'approved'
            ? 'Pre-approved demonstration baseline checklist for pilot category.'
            : null,
        approvedAt: def.initialStatus === 'approved' ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();

    const checklist = inserted[0];
    if (checklist) {
      await db.insert(checklistItems).values(
        def.items.map((item, idx) => ({
          checklistId: checklist.id,
          sortOrder: idx + 1,
          label: item.label,
          guidance: item.guidance,
          isMandatory: item.isMandatory,
          allowFailEscalation: item.allowFailEscalation,
        }))
      );
    }
  }

  seededConfirmed = true;
}

export async function ensureDatabaseSeeded(): Promise<void> {
  if (seededConfirmed) return;
  if (!seedPromise) {
    seedPromise = seedDatabase().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  await seedPromise;
}

// Run standalone when executed directly via `tsx src/db/seed.ts`
const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('seed.ts');

if (isDirectExecution) {
  import('dotenv/config')
    .then(() => seedDatabase())
    .then(() => {
      console.log('ResolveIQ database seed completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('ResolveIQ database seed failed:', err);
      process.exit(1);
    });
}
