import { ZipArchive } from 'archiver';
import bcrypt from 'bcryptjs';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { db } from '../db/index.ts';
import {
  aiAnalyses,
  appUsers,
  auditLogs,
  checklistItems,
  clients,
  diagnosticChecklists,
  engineeringEscalations,
  historicalTickets,
  investigationCheckResults,
  userClientAccess,
  workflowTickets,
} from '../db/schema.ts';
import { ensureDatabaseSeeded } from '../db/seed.ts';
import { runAiInvestigation } from './ai.ts';
import { computeHistoricalAnalytics, computeLiveWorkflowAnalytics } from './analytics.ts';
import { recordAuditLog } from './audit.ts';
import {
  type AuthRequest,
  type UserRole,
  canAccessClient,
  hydrateAuthUserById,
  requireAuth,
  requireRole,
  signDemoToken,
  upsertFirebaseUser,
} from './auth.ts';
import { adminAuth } from '../lib/firebase-admin.ts';

const DOCUMENTED_ENG_OUTCOMES = [
  'Fixed',
  'Insufficient info - returned to L1',
  'Config issue - returned to L1',
  'Duplicate of known issue',
  'Not a bug - how-to',
  'Not reproducible',
] as const;

export const apiRouter = Router();

// Lazily ensure seed on first API traffic (never eager at startup)
apiRouter.use(async (_req, res, next) => {
  try {
    await ensureDatabaseSeeded();
    next();
  } catch (err) {
    console.error('Database initialization error:', err);
    res.status(503).json({ error: 'Database is initializing or temporarily unavailable.' });
  }
});

// ---------------------------------------------------------------------------
// 1. Auth & Persona Routes
// ---------------------------------------------------------------------------
apiRouter.get('/auth/demo-personas', async (_req, res) => {
  try {
    const users = await db
      .select({
        id: appUsers.id,
        email: appUsers.email,
        name: appUsers.name,
        designation: appUsers.designation,
        role: appUsers.role,
        agentAlias: appUsers.agentAlias,
        hasGlobalClientAccess: appUsers.hasGlobalClientAccess,
      })
      .from(appUsers)
      .where(eq(appUsers.isActive, true))
      .orderBy(asc(appUsers.id));
    res.json({ personas: users });
  } catch (err) {
    console.error('Failed to fetch demo personas:', err);
    res.status(500).json({ error: 'Failed to load demo personas.' });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

apiRouter.post('/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid email and password are required.' });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(appUsers)
      .where(eq(appUsers.email, parsed.data.email.trim().toLowerCase()))
      .limit(1);
    const userRow = rows[0];
    if (!userRow || !userRow.isActive || !userRow.passwordHash) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const valid = await bcrypt.compare(parsed.data.password, userRow.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const hydrated = await hydrateAuthUserById(userRow.id);
    if (!hydrated) {
      res.status(401).json({ error: 'Account is disabled.' });
      return;
    }
    const token = signDemoToken({
      id: hydrated.id,
      email: hydrated.email,
      role: hydrated.role,
    });
    await recordAuditLog({
      actor: hydrated,
      actionType: 'USER_LOGIN',
      entityType: 'user',
      entityId: String(hydrated.id),
      details: { method: 'password' },
    });
    res.json({ token, user: hydrated });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

apiRouter.post('/auth/firebase', async (req, res) => {
  const parsed = z.object({ idToken: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Firebase idToken is required.' });
    return;
  }
  try {
    const decoded = await adminAuth.verifyIdToken(parsed.data.idToken);
    if (!decoded.email) {
      res.status(400).json({ error: 'Google account has no email address.' });
      return;
    }
    const user = await upsertFirebaseUser(decoded.uid, decoded.email, decoded.name);
    await recordAuditLog({
      actor: user,
      actionType: 'USER_LOGIN',
      entityType: 'user',
      entityId: String(user.id),
      details: { method: 'firebase_google_sso' },
    });
    res.json({ user });
  } catch (err) {
    console.error('Firebase token verification failed:', err);
    res.status(401).json({ error: 'Invalid Firebase token.' });
  }
});

apiRouter.get('/auth/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.authUser });
});

// ---------------------------------------------------------------------------
// 2. Analytics Routes (Historical CSV vs Live ResolveIQ Workflow)
// ---------------------------------------------------------------------------
apiRouter.get('/analytics/historical', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = await computeHistoricalAnalytics({
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      clientTier:
        typeof req.query.clientTier === 'string' ? req.query.clientTier : undefined,
      channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
      accessibleClientIds: req.authUser?.accessibleClientIds ?? null,
    });
    res.json(data);
  } catch (err) {
    console.error('Historical analytics error:', err);
    res.status(500).json({ error: 'Failed to compute historical analytics.' });
  }
});

apiRouter.get('/analytics/live', requireAuth, async (req: AuthRequest, res) => {
  try {
    const data = await computeLiveWorkflowAnalytics(
      req.authUser?.accessibleClientIds ?? null
    );
    res.json(data);
  } catch (err) {
    console.error('Live analytics error:', err);
    res.status(500).json({ error: 'Failed to compute live workflow analytics.' });
  }
});

// ---------------------------------------------------------------------------
// 3. Tickets Inbox, Detail, Adoption & Assignment
// ---------------------------------------------------------------------------
apiRouter.get('/tickets', requireAuth, async (req: AuthRequest, res) => {
  try {
    const authUser = req.authUser!;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 25)));
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category =
      typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const priority =
      typeof req.query.priority === 'string' ? req.query.priority.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const clientTier =
      typeof req.query.clientTier === 'string' ? req.query.clientTier.trim() : '';
    const escalated =
      typeof req.query.escalated === 'string' ? req.query.escalated.trim() : '';
    const adoptedFilter =
      typeof req.query.adopted === 'string' ? req.query.adopted.trim() : '';
    const sortBy =
      typeof req.query.sort === 'string' ? req.query.sort.trim() : 'created_desc';

    const conditions = [];
    if (!authUser.hasGlobalClientAccess && authUser.accessibleClientIds !== null) {
      if (authUser.accessibleClientIds.length === 0) {
        res.json({ tickets: [], total: 0, page, pageSize, totalPages: 0 });
        return;
      }
      conditions.push(inArray(historicalTickets.clientId, authUser.accessibleClientIds));
    }

    if (q) {
      const pattern = `%${q}%`;
      conditions.push(
        or(
          ilike(historicalTickets.ticketId, pattern),
          ilike(historicalTickets.description, pattern),
          ilike(historicalTickets.clientName, pattern),
          ilike(historicalTickets.category, pattern),
          ilike(historicalTickets.assignedAgent, pattern)
        )
      );
    }
    if (category && category !== 'ALL') {
      conditions.push(eq(historicalTickets.category, category));
    }
    if (priority && priority !== 'ALL') {
      conditions.push(eq(historicalTickets.priority, priority));
    }
    if (status && status !== 'ALL') {
      if (status === 'OPEN_ANY') {
        conditions.push(
          or(
            eq(historicalTickets.status, 'Open - with L1'),
            eq(historicalTickets.status, 'Open - with Engineering')
          )
        );
      } else {
        conditions.push(eq(historicalTickets.status, status));
      }
    }
    if (clientTier && clientTier !== 'ALL') {
      conditions.push(eq(historicalTickets.clientTier, clientTier));
    }
    if (escalated === 'yes') {
      conditions.push(eq(historicalTickets.escalatedToEng, true));
    } else if (escalated === 'no') {
      conditions.push(eq(historicalTickets.escalatedToEng, false));
    }

    const orderExpr =
      sortBy === 'created_asc'
        ? asc(historicalTickets.createdAtTs)
        : sortBy === 'priority'
          ? asc(historicalTickets.priority)
          : sortBy === 'resolution_desc'
            ? desc(sql`COALESCE(${historicalTickets.resolutionHours}, 999999)`)
            : desc(historicalTickets.createdAtTs);

    const baseTickets =
      conditions.length > 0
        ? await db
            .select()
            .from(historicalTickets)
            .where(and(...conditions))
            .orderBy(orderExpr)
        : await db.select().from(historicalTickets).orderBy(orderExpr);

    const allWorkflows = await db.select().from(workflowTickets);
    const wfByTicketId = new Map(allWorkflows.map((w) => [w.ticketId, w]));
    const users = await db.select().from(appUsers);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const filteredByAdoption = baseTickets.filter((t) => {
      const wf = wfByTicketId.get(t.ticketId);
      if (adoptedFilter === 'adopted') return Boolean(wf);
      if (adoptedFilter === 'unadopted') return !wf;
      return true;
    });

    const total = filteredByAdoption.length;
    const totalPages = Math.ceil(total / pageSize);
    const paged = filteredByAdoption.slice((page - 1) * pageSize, page * pageSize);

    const enriched = paged.map((t) => {
      const wf = wfByTicketId.get(t.ticketId);
      const assignedUser = wf?.assignedUserId ? userMap.get(wf.assignedUserId) : null;
      return {
        ticketId: t.ticketId,
        createdAtRaw: t.createdAtRaw,
        channel: t.channel,
        clientId: t.clientId,
        clientName: t.clientName,
        clientTier: t.clientTier,
        category: t.category,
        priority: t.priority,
        description: t.description,
        historicalAssignedAgent: t.assignedAgent,
        escalatedToEng: t.escalatedToEng,
        engTicketId: t.engTicketId,
        engHandoffs: t.engHandoffs,
        engOutcome: t.engOutcome,
        historicalStatus: t.status,
        reopenCount: t.reopenCount,
        csatScore: t.csatScore,
        resolutionHours: t.resolutionHours,
        workflow: wf
          ? {
              id: wf.id,
              adoptedAt: wf.adoptedAt,
              assignedUserId: wf.assignedUserId,
              assignedUserName: assignedUser?.name ?? null,
              assignedUserEmail: assignedUser?.email ?? null,
              investigationStatus: wf.investigationStatus,
              updatedAt: wf.updatedAt,
            }
          : null,
      };
    });

    res.json({ tickets: enriched, total, page, pageSize, totalPages });
  } catch (err) {
    console.error('Failed to list tickets:', err);
    res.status(500).json({ error: 'Failed to load tickets.' });
  }
});

async function loadFullTicketDetail(ticketId: string) {
  const rows = await db
    .select()
    .from(historicalTickets)
    .where(eq(historicalTickets.ticketId, ticketId))
    .limit(1);
  const ticket = rows[0];
  if (!ticket) return null;

  const wfRows = await db
    .select()
    .from(workflowTickets)
    .where(eq(workflowTickets.ticketId, ticketId))
    .limit(1);
  const wf = wfRows[0] ?? null;

  const users = await db.select().from(appUsers);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const checklistRows = await db
    .select()
    .from(diagnosticChecklists)
    .where(eq(diagnosticChecklists.category, ticket.category))
    .limit(1);
  const checklist = checklistRows[0] ?? null;
  const items = checklist
    ? await db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklist.id))
        .orderBy(asc(checklistItems.sortOrder))
    : [];

  const checkResults = wf
    ? await db
        .select()
        .from(investigationCheckResults)
        .where(eq(investigationCheckResults.workflowTicketId, wf.id))
    : [];
  const resMap = new Map(checkResults.map((r) => [r.checklistItemId, r]));

  const escalations = wf
    ? await db
        .select()
        .from(engineeringEscalations)
        .where(eq(engineeringEscalations.workflowTicketId, wf.id))
        .orderBy(desc(engineeringEscalations.submittedAt))
    : [];

  const analyses = await db
    .select()
    .from(aiAnalyses)
    .where(eq(aiAnalyses.ticketId, ticketId))
    .orderBy(desc(aiAnalyses.createdAt))
    .limit(5);

  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.ticketId, ticketId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(30);

  return {
    historical: {
      ticketId: ticket.ticketId,
      createdAtRaw: ticket.createdAtRaw,
      channel: ticket.channel,
      clientId: ticket.clientId,
      clientName: ticket.clientName,
      clientTier: ticket.clientTier,
      category: ticket.category,
      priority: ticket.priority,
      description: ticket.description,
      assignedAgent: ticket.assignedAgent,
      firstResponseAtRaw: ticket.firstResponseAtRaw,
      escalatedToEng: ticket.escalatedToEng,
      engTicketId: ticket.engTicketId,
      engHandoffs: ticket.engHandoffs,
      engOutcome: ticket.engOutcome,
      status: ticket.status,
      firstClosedAtRaw: ticket.firstClosedAtRaw,
      finalClosedAtRaw: ticket.finalClosedAtRaw,
      reopenCount: ticket.reopenCount,
      csatScore: ticket.csatScore,
      resolutionHours: ticket.resolutionHours,
      firstResponseMinutes: ticket.firstResponseMinutes,
    },
    workflow: wf
      ? {
          id: wf.id,
          ticketId: wf.ticketId,
          adoptedByName: userMap.get(wf.adoptedByUserId)?.name ?? 'Unknown',
          adoptedAt: wf.adoptedAt,
          assignedUserId: wf.assignedUserId,
          assignedUserName: wf.assignedUserId
            ? (userMap.get(wf.assignedUserId)?.name ?? null)
            : null,
          assignedUserEmail: wf.assignedUserId
            ? (userMap.get(wf.assignedUserId)?.email ?? null)
            : null,
          assignedAt: wf.assignedAt,
          investigationStatus: wf.investigationStatus,
          investigationNotes: wf.investigationNotes,
          evidenceSummary: wf.evidenceSummary,
          evidenceRefs: wf.evidenceRefs,
          updatedAt: wf.updatedAt,
        }
      : null,
    checklist: checklist
      ? {
          id: checklist.id,
          category: checklist.category,
          title: checklist.title,
          description: checklist.description,
          isProposedDemo: checklist.isProposedDemo,
          status: checklist.status,
          version: checklist.version,
          approvedByName: checklist.approvedByUserId
            ? (userMap.get(checklist.approvedByUserId)?.name ?? null)
            : null,
          approvedAt: checklist.approvedAt,
          approvalNotes: checklist.approvalNotes,
          items: items.map((it) => {
            const cr = resMap.get(it.id);
            return {
              id: it.id,
              sortOrder: it.sortOrder,
              label: it.label,
              guidance: it.guidance,
              isMandatory: it.isMandatory,
              allowFailEscalation: it.allowFailEscalation,
              result: cr?.result ?? 'pending',
              notes: cr?.notes ?? '',
              evidenceRef: cr?.evidenceRef ?? '',
              updatedAt: cr?.updatedAt ?? null,
            };
          }),
        }
      : null,
    escalations: escalations.map((e) => ({
      ...e,
      submittedByName: userMap.get(e.submittedByUserId)?.name ?? 'Unknown',
      reviewedByName: e.reviewedByUserId
        ? (userMap.get(e.reviewedByUserId)?.name ?? null)
        : null,
    })),
    latestAiAnalysis: analyses[0] ?? null,
    auditTrail: logs,
  };
}

apiRouter.get('/tickets/:ticketId', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ticketId = String(req.params.ticketId);
    const detail = await loadFullTicketDetail(ticketId);
    if (!detail) {
      res.status(404).json({ error: `Ticket ${ticketId} not found.` });
      return;
    }
    if (!canAccessClient(req.authUser!, detail.historical.clientId)) {
      res
        .status(403)
        .json({ error: 'Forbidden: Your account does not have access to this client.' });
      return;
    }
    res.json(detail);
  } catch (err) {
    console.error('Failed to get ticket detail:', err);
    res.status(500).json({ error: 'Failed to load ticket details.' });
  }
});

apiRouter.post(
  '/tickets/:ticketId/adopt',
  requireAuth,
  requireRole('support_manager', 'platform_admin'),
  async (req: AuthRequest, res) => {
    try {
      const ticketId = String(req.params.ticketId);
      const authUser = req.authUser!;
      const rows = await db
        .select()
        .from(historicalTickets)
        .where(eq(historicalTickets.ticketId, ticketId))
        .limit(1);
      const ticket = rows[0];
      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found.` });
        return;
      }
      if (!canAccessClient(authUser, ticket.clientId)) {
        res.status(403).json({ error: 'Forbidden: Client access denied.' });
        return;
      }

      const existing = await db
        .select()
        .from(workflowTickets)
        .where(eq(workflowTickets.ticketId, ticketId))
        .limit(1);
      if (existing[0]) {
        res.status(409).json({ error: `Ticket ${ticketId} is already adopted in ResolveIQ.` });
        return;
      }

      const inserted = await db
        .insert(workflowTickets)
        .values({
          ticketId,
          adoptedByUserId: authUser.id,
          investigationStatus: 'adopted',
          investigationNotes: '',
          evidenceSummary: '',
          evidenceRefs: [],
        })
        .returning();

      await recordAuditLog({
        actor: authUser,
        actionType: 'TICKET_ADOPTED',
        entityType: 'workflow_ticket',
        entityId: String(inserted[0].id),
        ticketId,
        details: { category: ticket.category, clientId: ticket.clientId },
      });

      const detail = await loadFullTicketDetail(ticketId);
      res.status(201).json(detail);
    } catch (err) {
      console.error('Failed to adopt ticket:', err);
      res.status(500).json({ error: 'Failed to adopt ticket.' });
    }
  }
);

apiRouter.post(
  '/tickets/:ticketId/assign',
  requireAuth,
  requireRole('support_manager', 'platform_admin'),
  async (req: AuthRequest, res) => {
    const parsed = z.object({ assignedUserId: z.number().int().positive() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid assignedUserId is required.' });
      return;
    }
    try {
      const ticketId = String(req.params.ticketId);
      const authUser = req.authUser!;
      const ticketRows = await db
        .select()
        .from(historicalTickets)
        .where(eq(historicalTickets.ticketId, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found.` });
        return;
      }
      if (!canAccessClient(authUser, ticket.clientId)) {
        res.status(403).json({ error: 'Forbidden: Client access denied.' });
        return;
      }

      const wfRows = await db
        .select()
        .from(workflowTickets)
        .where(eq(workflowTickets.ticketId, ticketId))
        .limit(1);
      const wf = wfRows[0];
      if (!wf) {
        res.status(400).json({
          error: 'Ticket must be adopted into ResolveIQ before assigning an investigator.',
        });
        return;
      }

      const assignee = await hydrateAuthUserById(parsed.data.assignedUserId);
      if (!assignee || assignee.role !== 'support_agent') {
        res.status(400).json({
          error: 'Assignee must be an active Support Agent.',
        });
        return;
      }
      if (!canAccessClient(assignee, ticket.clientId)) {
        res.status(403).json({
          error: `Support Agent ${assignee.name} does not have client access to ${ticket.clientName} (${ticket.clientId}).`,
        });
        return;
      }

      const nextStatus =
        wf.investigationStatus === 'adopted' ? 'in_progress' : wf.investigationStatus;

      await db
        .update(workflowTickets)
        .set({
          assignedUserId: assignee.id,
          assignedAt: new Date(),
          investigationStatus: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(workflowTickets.id, wf.id));

      await recordAuditLog({
        actor: authUser,
        actionType: 'TICKET_ASSIGNED',
        entityType: 'workflow_ticket',
        entityId: String(wf.id),
        ticketId,
        details: {
          assignedUserId: assignee.id,
          assignedUserName: assignee.name,
          previousUserId: wf.assignedUserId,
        },
      });

      const detail = await loadFullTicketDetail(ticketId);
      res.json(detail);
    } catch (err) {
      console.error('Failed to assign ticket:', err);
      res.status(500).json({ error: 'Failed to assign ticket.' });
    }
  }
);

apiRouter.get('/agents', requireAuth, async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: appUsers.id,
        name: appUsers.name,
        email: appUsers.email,
        designation: appUsers.designation,
        agentAlias: appUsers.agentAlias,
        hasGlobalClientAccess: appUsers.hasGlobalClientAccess,
      })
      .from(appUsers)
      .where(and(eq(appUsers.role, 'support_agent'), eq(appUsers.isActive, true)))
      .orderBy(asc(appUsers.name));
    res.json({ agents: rows });
  } catch (err) {
    console.error('Failed to list agents:', err);
    res.status(500).json({ error: 'Failed to load support agents.' });
  }
});

// ---------------------------------------------------------------------------
// 4. Investigations & Checklist Execution
// ---------------------------------------------------------------------------
apiRouter.get('/investigations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const authUser = req.authUser!;
    const mineOnly = req.query.mine === 'true';

    const wfs = await db
      .select()
      .from(workflowTickets)
      .orderBy(desc(workflowTickets.updatedAt));
    const tickets = await db.select().from(historicalTickets);
    const ticketMap = new Map(tickets.map((t) => [t.ticketId, t]));
    const users = await db.select().from(appUsers);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const checklists = await db.select().from(diagnosticChecklists);
    const checklistByCat = new Map(checklists.map((c) => [c.category, c]));
    const allItems = await db.select().from(checklistItems);
    const itemsByChecklist = new Map<number, typeof allItems>();
    for (const it of allItems) {
      const arr = itemsByChecklist.get(it.checklistId) ?? [];
      arr.push(it);
      itemsByChecklist.set(it.checklistId, arr);
    }
    const allResults = await db.select().from(investigationCheckResults);
    const resultsByWf = new Map<number, typeof allResults>();
    for (const r of allResults) {
      const arr = resultsByWf.get(r.workflowTicketId) ?? [];
      arr.push(r);
      resultsByWf.set(r.workflowTicketId, arr);
    }

    const allEscalations = await db
      .select()
      .from(engineeringEscalations)
      .orderBy(desc(engineeringEscalations.submittedAt));
    const latestEscByWf = new Map<number, (typeof allEscalations)[0]>();
    for (const e of allEscalations) {
      if (!latestEscByWf.has(e.workflowTicketId)) {
        latestEscByWf.set(e.workflowTicketId, e);
      }
    }

    const filtered = wfs.filter((wf) => {
      const t = ticketMap.get(wf.ticketId);
      if (!t) return false;
      if (!canAccessClient(authUser, t.clientId)) return false;
      if (mineOnly) {
        return wf.assignedUserId === authUser.id;
      }
      return true;
    });

    const items = filtered.map((wf) => {
      const t = ticketMap.get(wf.ticketId)!;
      const cl = checklistByCat.get(t.category);
      const clItems = cl ? (itemsByChecklist.get(cl.id) ?? []) : [];
      const wfResults = resultsByWf.get(wf.id) ?? [];
      const completedCount = clItems.filter((it) => {
        const res = wfResults.find((r) => r.checklistItemId === it.id);
        return res && res.result !== 'pending';
      }).length;
      const latestEsc = latestEscByWf.get(wf.id);

      return {
        workflowId: wf.id,
        ticketId: wf.ticketId,
        category: t.category,
        priority: t.priority,
        clientId: t.clientId,
        clientName: t.clientName,
        clientTier: t.clientTier,
        description: t.description,
        channel: t.channel,
        createdAtRaw: t.createdAtRaw,
        investigationStatus: wf.investigationStatus,
        adoptedAt: wf.adoptedAt,
        adoptedByName: userMap.get(wf.adoptedByUserId)?.name ?? 'Unknown',
        assignedUserId: wf.assignedUserId,
        assignedUserName: wf.assignedUserId
          ? (userMap.get(wf.assignedUserId)?.name ?? null)
          : null,
        checklistStatus: cl?.status ?? 'missing',
        checklistTitle: cl?.title ?? null,
        checklistTotalItems: clItems.length,
        checklistCompletedItems: completedCount,
        latestEscalationStatus: latestEsc?.status ?? null,
        latestEngOutcome: latestEsc?.engOutcome ?? null,
        updatedAt: wf.updatedAt,
      };
    });

    res.json({ investigations: items });
  } catch (err) {
    console.error('Failed to load investigations:', err);
    res.status(500).json({ error: 'Failed to load investigations.' });
  }
});

const checklistSaveSchema = z.object({
  items: z
    .array(
      z.object({
        checklistItemId: z.number().int().positive(),
        result: z.enum(['pending', 'pass', 'fail', 'na']),
        notes: z.string().max(2000).optional().default(''),
        evidenceRef: z.string().max(500).optional().default(''),
      })
    )
    .min(1),
});

apiRouter.put(
  '/investigations/:ticketId/checklist',
  requireAuth,
  requireRole('support_agent'),
  async (req: AuthRequest, res) => {
    const parsed = checklistSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid checklist submission payload.' });
      return;
    }

    try {
      const ticketId = String(req.params.ticketId);
      const authUser = req.authUser!;
      const ticketRows = await db
        .select()
        .from(historicalTickets)
        .where(eq(historicalTickets.ticketId, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found.` });
        return;
      }
      if (!canAccessClient(authUser, ticket.clientId)) {
        res.status(403).json({ error: 'Forbidden: Client access denied.' });
        return;
      }

      const wfRows = await db
        .select()
        .from(workflowTickets)
        .where(eq(workflowTickets.ticketId, ticketId))
        .limit(1);
      const wf = wfRows[0];
      if (!wf) {
        res.status(404).json({ error: 'Ticket is not adopted in ResolveIQ.' });
        return;
      }
      if (wf.assignedUserId !== authUser.id) {
        res.status(403).json({
          error: 'Forbidden: Only the assigned Support Agent can record investigation checklist results.',
        });
        return;
      }

      const clRows = await db
        .select()
        .from(diagnosticChecklists)
        .where(eq(diagnosticChecklists.category, ticket.category))
        .limit(1);
      const cl = clRows[0];
      if (!cl || cl.status !== 'approved') {
        res.status(400).json({
          error: `Checklist for "${ticket.category}" is currently "${cl?.status ?? 'missing'}" and must be approved by Operations (Ritika) before investigation checks can be recorded.`,
        });
        return;
      }

      const validItems = await db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, cl.id));
      const validItemIds = new Set(validItems.map((i) => i.id));

      for (const entry of parsed.data.items) {
        if (!validItemIds.has(entry.checklistItemId)) {
          res.status(400).json({
            error: `Checklist item ${entry.checklistItemId} does not belong to category ${ticket.category}.`,
          });
          return;
        }
        await db
          .insert(investigationCheckResults)
          .values({
            workflowTicketId: wf.id,
            checklistItemId: entry.checklistItemId,
            result: entry.result,
            notes: entry.notes,
            evidenceRef: entry.evidenceRef,
            updatedByUserId: authUser.id,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              investigationCheckResults.workflowTicketId,
              investigationCheckResults.checklistItemId,
            ],
            set: {
              result: entry.result,
              notes: entry.notes,
              evidenceRef: entry.evidenceRef,
              updatedByUserId: authUser.id,
              updatedAt: new Date(),
            },
          });
      }

      // Check completion to update workflow status cleanly
      const updatedResults = await db
        .select()
        .from(investigationCheckResults)
        .where(eq(investigationCheckResults.workflowTicketId, wf.id));
      const resMap = new Map(updatedResults.map((r) => [r.checklistItemId, r.result]));
      const allMandatoryDone = validItems
        .filter((i) => i.isMandatory)
        .every((i) => {
          const val = resMap.get(i.id);
          return val && val !== 'pending';
        });

      const nextStatus =
        wf.investigationStatus === 'escalated'
          ? 'escalated'
          : allMandatoryDone && wf.investigationNotes.trim().length > 0
            ? 'ready_for_escalation'
            : 'in_progress';

      await db
        .update(workflowTickets)
        .set({
          investigationStatus: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(workflowTickets.id, wf.id));

      await recordAuditLog({
        actor: authUser,
        actionType: 'CHECKLIST_RESULTS_SAVED',
        entityType: 'workflow_ticket',
        entityId: String(wf.id),
        ticketId,
        details: {
          itemsUpdated: parsed.data.items.length,
          allMandatoryDone,
        },
      });

      const detail = await loadFullTicketDetail(ticketId);
      res.json(detail);
    } catch (err) {
      console.error('Failed to save checklist results:', err);
      res.status(500).json({ error: 'Failed to save checklist results.' });
    }
  }
);

const notesUpdateSchema = z.object({
  investigationNotes: z.string().max(10000),
  evidenceSummary: z.string().max(5000).optional().default(''),
  evidenceRefs: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        type: z.string().min(1).max(50),
        value: z.string().min(1).max(1000),
        addedBy: z.string().optional(),
        addedAt: z.string().optional(),
      })
    )
    .optional(),
  markResolvedL1: z.boolean().optional(),
});

apiRouter.put(
  '/investigations/:ticketId/notes',
  requireAuth,
  requireRole('support_agent'),
  async (req: AuthRequest, res) => {
    const parsed = notesUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid notes/evidence payload.' });
      return;
    }

    try {
      const ticketId = String(req.params.ticketId);
      const authUser = req.authUser!;
      const wfRows = await db
        .select()
        .from(workflowTickets)
        .where(eq(workflowTickets.ticketId, ticketId))
        .limit(1);
      const wf = wfRows[0];
      if (!wf) {
        res.status(404).json({ error: 'Adopted ticket not found.' });
        return;
      }
      if (wf.assignedUserId !== authUser.id) {
        res.status(403).json({
          error: 'Forbidden: Only the assigned Support Agent can update investigation notes and evidence.',
        });
        return;
      }

      const ticketRows = await db
        .select()
        .from(historicalTickets)
        .where(eq(historicalTickets.ticketId, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (ticket && !canAccessClient(authUser, ticket.clientId)) {
        res.status(403).json({ error: 'Forbidden: Client access denied.' });
        return;
      }

      const normalizedRefs = (parsed.data.evidenceRefs ?? wf.evidenceRefs).map((r) => ({
        label: r.label,
        type: r.type,
        value: r.value,
        addedBy: r.addedBy || authUser.name,
        addedAt: r.addedAt || new Date().toISOString(),
      }));

      let nextStatus = wf.investigationStatus;
      if (parsed.data.markResolvedL1) {
        if (parsed.data.investigationNotes.trim().length < 10) {
          res.status(400).json({
            error: 'Please enter resolution notes (min 10 chars) before resolving at L1.',
          });
          return;
        }
        nextStatus = 'resolved_l1';
      } else if (wf.investigationStatus === 'adopted') {
        nextStatus = 'in_progress';
      }

      await db
        .update(workflowTickets)
        .set({
          investigationNotes: parsed.data.investigationNotes,
          evidenceSummary: parsed.data.evidenceSummary,
          evidenceRefs: normalizedRefs,
          investigationStatus: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(workflowTickets.id, wf.id));

      await recordAuditLog({
        actor: authUser,
        actionType: parsed.data.markResolvedL1
          ? 'INVESTIGATION_RESOLVED_L1'
          : 'INVESTIGATION_NOTES_UPDATED',
        entityType: 'workflow_ticket',
        entityId: String(wf.id),
        ticketId,
        details: {
          evidenceCount: normalizedRefs.length,
          notesLength: parsed.data.investigationNotes.length,
        },
      });

      const detail = await loadFullTicketDetail(ticketId);
      res.json(detail);
    } catch (err) {
      console.error('Failed to update investigation notes:', err);
      res.status(500).json({ error: 'Failed to update investigation notes.' });
    }
  }
);

// ---------------------------------------------------------------------------
// 5. AI Investigation Assistant Routes
// ---------------------------------------------------------------------------
apiRouter.post('/ai/investigate/:ticketId', requireAuth, async (req: AuthRequest, res) => {
  const parsed = z
    .object({ customQuery: z.string().max(1000).optional() })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid AI query payload.' });
    return;
  }
  try {
    const ticketId = String(req.params.ticketId);
    const authUser = req.authUser!;
    const rows = await db
      .select()
      .from(historicalTickets)
      .where(eq(historicalTickets.ticketId, ticketId))
      .limit(1);
    const ticket = rows[0];
    if (!ticket) {
      res.status(404).json({ error: `Ticket ${ticketId} not found.` });
      return;
    }
    if (!canAccessClient(authUser, ticket.clientId)) {
      res.status(403).json({ error: 'Forbidden: Client access denied.' });
      return;
    }

    const result = await runAiInvestigation({
      ticketId,
      actorUserId: authUser.id,
      customQuery: parsed.data.customQuery,
    });

    await recordAuditLog({
      actor: authUser,
      actionType: 'AI_INVESTIGATION_RUN',
      entityType: 'ticket',
      entityId: ticketId,
      ticketId,
      details: {
        retrievalMethod: result.retrievalMethod,
        aiSynthesisMode: result.aiSynthesisMode,
        similarCount: result.similarTickets.length,
      },
    });

    res.json(result);
  } catch (err) {
    console.error('AI investigation error:', err);
    res.status(500).json({ error: 'Failed to run AI investigation.' });
  }
});

// ---------------------------------------------------------------------------
// 6. Engineering Escalation & Review Routes (Strict Validation + RBAC)
// ---------------------------------------------------------------------------
const escalationCreateSchema = z.object({
  ticketId: z.string().min(3),
  problemSummary: z.string().trim().min(12, 'Problem summary must be at least 12 characters.'),
  businessImpact: z.string().trim().min(8, 'Business impact is required.'),
  expectedBehavior: z.string().trim().min(8, 'Expected behavior is required.'),
  actualBehavior: z.string().trim().min(8, 'Actual behavior is required.'),
  stepsPerformed: z.string().trim().min(12, 'L1 troubleshooting steps performed are required.'),
  diagnosticEvidence: z.string().trim().min(10, 'Diagnostic evidence is required.'),
});

apiRouter.post(
  '/escalations',
  requireAuth,
  requireRole('support_agent'),
  async (req: AuthRequest, res) => {
    const parsed = escalationCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(' '),
      });
      return;
    }

    try {
      const authUser = req.authUser!;
      const { ticketId } = parsed.data;

      const ticketRows = await db
        .select()
        .from(historicalTickets)
        .where(eq(historicalTickets.ticketId, ticketId))
        .limit(1);
      const ticket = ticketRows[0];
      if (!ticket) {
        res.status(404).json({ error: `Ticket ${ticketId} not found.` });
        return;
      }
      if (!canAccessClient(authUser, ticket.clientId)) {
        res.status(403).json({ error: 'Forbidden: Client access denied.' });
        return;
      }

      const wfRows = await db
        .select()
        .from(workflowTickets)
        .where(eq(workflowTickets.ticketId, ticketId))
        .limit(1);
      const wf = wfRows[0];
      if (!wf) {
        res.status(400).json({
          error: 'Ticket must be adopted into ResolveIQ before submitting an escalation.',
        });
        return;
      }
      if (wf.assignedUserId !== authUser.id) {
        res.status(403).json({
          error: 'Forbidden: Only the assigned Support Agent can escalate this ticket.',
        });
        return;
      }

      // Check active escalations to prevent duplicate submissions
      const existingEscs = await db
        .select()
        .from(engineeringEscalations)
        .where(eq(engineeringEscalations.workflowTicketId, wf.id));

      const activeEsc = existingEscs.find(
        (e) => e.status === 'submitted' || e.status === 'under_review'
      );
      if (activeEsc) {
        res.status(409).json({
          error: `Duplicate escalation blocked: Handoff #${activeEsc.handoffNumber} is already awaiting Engineering review.`,
        });
        return;
      }

      // Validate Operations-approved checklist exists and mandatory checks are completed
      const clRows = await db
        .select()
        .from(diagnosticChecklists)
        .where(eq(diagnosticChecklists.category, ticket.category))
        .limit(1);
      const cl = clRows[0];
      if (!cl || cl.status !== 'approved') {
        res.status(400).json({
          error: `Escalation blocked: Category "${ticket.category}" does not have an Operations-approved diagnostic checklist (status: ${cl?.status ?? 'missing'}).`,
        });
        return;
      }

      const items = await db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, cl.id));
      const results = await db
        .select()
        .from(investigationCheckResults)
        .where(eq(investigationCheckResults.workflowTicketId, wf.id));
      const resMap = new Map(results.map((r) => [r.checklistItemId, r]));

      const incompleteMandatory = items.filter((it) => {
        if (!it.isMandatory) return false;
        const r = resMap.get(it.id);
        return !r || r.result === 'pending';
      });
      if (incompleteMandatory.length > 0) {
        res.status(400).json({
          error: `Escalation blocked: ${incompleteMandatory.length} mandatory checklist item(s) still pending (${incompleteMandatory.map((m) => m.label).join('; ')}).`,
        });
        return;
      }

      const blockingFail = items.filter((it) => {
        if (it.allowFailEscalation) return false;
        const r = resMap.get(it.id);
        return r?.result === 'fail';
      });
      if (blockingFail.length > 0) {
        res.status(400).json({
          error: `Escalation blocked: Required documentation/evidence step failed and must be resolved before handoff (${blockingFail.map((b) => b.label).join('; ')}).`,
        });
        return;
      }

      if (wf.investigationNotes.trim().length < 10) {
        res.status(400).json({
          error: 'Escalation blocked: L1 investigation notes (min 10 chars) must be saved prior to escalation.',
        });
        return;
      }

      const handoffNumber = existingEscs.length + 1;
      const inserted = await db
        .insert(engineeringEscalations)
        .values({
          workflowTicketId: wf.id,
          ticketId,
          handoffNumber,
          submittedByUserId: authUser.id,
          problemSummary: parsed.data.problemSummary,
          businessImpact: parsed.data.businessImpact,
          expectedBehavior: parsed.data.expectedBehavior,
          actualBehavior: parsed.data.actualBehavior,
          stepsPerformed: parsed.data.stepsPerformed,
          diagnosticEvidence: parsed.data.diagnosticEvidence,
          status: 'submitted',
        })
        .returning();

      await db
        .update(workflowTickets)
        .set({
          investigationStatus: 'escalated',
          updatedAt: new Date(),
        })
        .where(eq(workflowTickets.id, wf.id));

      await recordAuditLog({
        actor: authUser,
        actionType: 'ESCALATION_SUBMITTED',
        entityType: 'engineering_escalation',
        entityId: String(inserted[0].id),
        ticketId,
        details: {
          handoffNumber,
          checklistId: cl.id,
          failedChecksAllowed: items.filter((it) => resMap.get(it.id)?.result === 'fail')
            .length,
        },
      });

      const detail = await loadFullTicketDetail(ticketId);
      res.status(201).json({ escalation: inserted[0], detail });
    } catch (err) {
      console.error('Failed to submit escalation:', err);
      res.status(500).json({ error: 'Failed to submit engineering escalation.' });
    }
  }
);

apiRouter.get('/escalations', requireAuth, async (req: AuthRequest, res) => {
  try {
    const authUser = req.authUser!;
    const escs = await db
      .select()
      .from(engineeringEscalations)
      .orderBy(desc(engineeringEscalations.submittedAt));

    const tickets = await db.select().from(historicalTickets);
    const ticketMap = new Map(tickets.map((t) => [t.ticketId, t]));
    const wfs = await db.select().from(workflowTickets);
    const wfMap = new Map(wfs.map((w) => [w.id, w]));
    const users = await db.select().from(appUsers);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const allChecklists = await db.select().from(diagnosticChecklists);
    const clByCat = new Map(allChecklists.map((c) => [c.category, c]));
    const allClItems = await db.select().from(checklistItems);
    const clItemsById = new Map(allClItems.map((i) => [i.id, i]));
    const allCheckRes = await db.select().from(investigationCheckResults);
    const checkResByWf = new Map<number, typeof allCheckRes>();
    for (const cr of allCheckRes) {
      const arr = checkResByWf.get(cr.workflowTicketId) ?? [];
      arr.push(cr);
      checkResByWf.set(cr.workflowTicketId, arr);
    }

    const filtered = escs.filter((e) => {
      const t = ticketMap.get(e.ticketId);
      if (!t) return false;
      return canAccessClient(authUser, t.clientId);
    });

    const enriched = filtered.map((e) => {
      const t = ticketMap.get(e.ticketId)!;
      const wf = wfMap.get(e.workflowTicketId);
      const cl = clByCat.get(t.category);
      const wfResults = (checkResByWf.get(e.workflowTicketId) ?? []).map((r) => ({
        itemId: r.checklistItemId,
        label: clItemsById.get(r.checklistItemId)?.label ?? 'Checklist Item',
        result: r.result,
        notes: r.notes,
        evidenceRef: r.evidenceRef,
      }));
      return {
        ...e,
        category: t.category,
        priority: t.priority,
        clientId: t.clientId,
        clientName: t.clientName,
        clientTier: t.clientTier,
        description: t.description,
        submittedByName: userMap.get(e.submittedByUserId)?.name ?? 'Unknown',
        reviewedByName: e.reviewedByUserId
          ? (userMap.get(e.reviewedByUserId)?.name ?? null)
          : null,
        investigationNotes: wf?.investigationNotes ?? '',
        evidenceSummary: wf?.evidenceSummary ?? '',
        evidenceRefs: wf?.evidenceRefs ?? [],
        checklistTitle: cl?.title ?? null,
        checklistResults: wfResults,
      };
    });

    res.json({ escalations: enriched });
  } catch (err) {
    console.error('Failed to list escalations:', err);
    res.status(500).json({ error: 'Failed to load engineering escalations.' });
  }
});

const engReviewSchema = z.object({
  action: z.enum(['return_to_l1', 'record_outcome', 'add_note']),
  engOutcome: z.enum(DOCUMENTED_ENG_OUTCOMES).optional(),
  returnReason: z.string().max(2000).optional(),
  engNotes: z.string().trim().min(3, 'Engineering comment/notes are required.').max(5000),
});

apiRouter.post(
  '/escalations/:id/review',
  requireAuth,
  requireRole('engineering_manager'),
  async (req: AuthRequest, res) => {
    const parsed = engReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues.map((i) => i.message).join(' '),
      });
      return;
    }

    try {
      const escId = Number(req.params.id);
      const authUser = req.authUser!;
      const rows = await db
        .select()
        .from(engineeringEscalations)
        .where(eq(engineeringEscalations.id, escId))
        .limit(1);
      const esc = rows[0];
      if (!esc) {
        res.status(404).json({ error: `Escalation #${escId} not found.` });
        return;
      }

      const { action, engOutcome, returnReason, engNotes } = parsed.data;

      if (action === 'return_to_l1') {
        if (!returnReason || returnReason.trim().length < 5) {
          res.status(400).json({
            error: 'A clear return reason (min 5 chars) is required when returning an escalation to L1.',
          });
          return;
        }
        const outcomeVal =
          engOutcome === 'Config issue - returned to L1'
            ? 'Config issue - returned to L1'
            : 'Insufficient info - returned to L1';

        const updated = await db
          .update(engineeringEscalations)
          .set({
            status: 'returned_to_l1',
            engOutcome: outcomeVal,
            returnReason: returnReason.trim(),
            engNotes,
            reviewedByUserId: authUser.id,
            reviewedAt: new Date(),
          })
          .where(eq(engineeringEscalations.id, escId))
          .returning();

        await db
          .update(workflowTickets)
          .set({ investigationStatus: 'returned_to_l1', updatedAt: new Date() })
          .where(eq(workflowTickets.id, esc.workflowTicketId));

        await recordAuditLog({
          actor: authUser,
          actionType: 'ESCALATION_RETURNED_TO_L1',
          entityType: 'engineering_escalation',
          entityId: String(escId),
          ticketId: esc.ticketId,
          details: { engOutcome: outcomeVal, returnReason },
        });

        res.json({ escalation: updated[0] });
        return;
      }

      if (action === 'record_outcome') {
        if (!engOutcome) {
          res.status(400).json({
            error: 'Please select a documented engineering outcome.',
          });
          return;
        }
        const isReturnOutcome =
          engOutcome === 'Insufficient info - returned to L1' ||
          engOutcome === 'Config issue - returned to L1';

        const updated = await db
          .update(engineeringEscalations)
          .set({
            status: isReturnOutcome ? 'returned_to_l1' : 'outcome_recorded',
            engOutcome,
            returnReason: isReturnOutcome ? returnReason?.trim() || engNotes : null,
            engNotes,
            reviewedByUserId: authUser.id,
            reviewedAt: new Date(),
          })
          .where(eq(engineeringEscalations.id, escId))
          .returning();

        await db
          .update(workflowTickets)
          .set({
            investigationStatus: isReturnOutcome ? 'returned_to_l1' : 'closed',
            updatedAt: new Date(),
          })
          .where(eq(workflowTickets.id, esc.workflowTicketId));

        await recordAuditLog({
          actor: authUser,
          actionType: 'ENGINEERING_OUTCOME_RECORDED',
          entityType: 'engineering_escalation',
          entityId: String(escId),
          ticketId: esc.ticketId,
          details: { engOutcome },
        });

        res.json({ escalation: updated[0] });
        return;
      }

      // add_note
      const mergedNotes = esc.engNotes
        ? `${esc.engNotes}\n[${new Date().toISOString()} — ${authUser.name}]: ${engNotes}`
        : `[${new Date().toISOString()} — ${authUser.name}]: ${engNotes}`;

      const updated = await db
        .update(engineeringEscalations)
        .set({
          status: esc.status === 'submitted' ? 'under_review' : esc.status,
          engNotes: mergedNotes,
          reviewedByUserId: authUser.id,
          reviewedAt: new Date(),
        })
        .where(eq(engineeringEscalations.id, escId))
        .returning();

      await recordAuditLog({
        actor: authUser,
        actionType: 'ENGINEERING_NOTE_ADDED',
        entityType: 'engineering_escalation',
        entityId: String(escId),
        ticketId: esc.ticketId,
        details: { noteLength: engNotes.length },
      });

      res.json({ escalation: updated[0] });
    } catch (err) {
      console.error('Failed to review escalation:', err);
      res.status(500).json({ error: 'Failed to update engineering review.' });
    }
  }
);

// ---------------------------------------------------------------------------
// 7. Diagnostic Checklist Governance & Admin Routes
// ---------------------------------------------------------------------------
apiRouter.get('/checklists', requireAuth, async (_req, res) => {
  try {
    const cls = await db
      .select()
      .from(diagnosticChecklists)
      .orderBy(asc(diagnosticChecklists.id));
    const items = await db
      .select()
      .from(checklistItems)
      .orderBy(asc(checklistItems.sortOrder));
    const users = await db.select().from(appUsers);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const grouped = cls.map((c) => ({
      ...c,
      approvedByName: c.approvedByUserId
        ? (userMap.get(c.approvedByUserId)?.name ?? null)
        : null,
      items: items.filter((i) => i.checklistId === c.id),
    }));
    res.json({ checklists: grouped });
  } catch (err) {
    console.error('Failed to list checklists:', err);
    res.status(500).json({ error: 'Failed to load checklists.' });
  }
});

apiRouter.post(
  '/checklists/:id/decision',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        decision: z.enum(['approved', 'rejected', 'pending_approval']),
        approvalNotes: z.string().max(1000).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid decision is required.' });
      return;
    }

    try {
      const id = Number(req.params.id);
      const authUser = req.authUser!;
      const rows = await db
        .select()
        .from(diagnosticChecklists)
        .where(eq(diagnosticChecklists.id, id))
        .limit(1);
      if (!rows[0]) {
        res.status(404).json({ error: 'Checklist not found.' });
        return;
      }

      const updated = await db
        .update(diagnosticChecklists)
        .set({
          status: parsed.data.decision,
          approvalNotes: parsed.data.approvalNotes ?? rows[0].approvalNotes,
          approvedByUserId: parsed.data.decision === 'approved' ? authUser.id : null,
          approvedAt: parsed.data.decision === 'approved' ? new Date() : null,
        })
        .where(eq(diagnosticChecklists.id, id))
        .returning();

      await recordAuditLog({
        actor: authUser,
        actionType: `CHECKLIST_${parsed.data.decision.toUpperCase()}`,
        entityType: 'diagnostic_checklist',
        entityId: String(id),
        details: {
          category: rows[0].category,
          decision: parsed.data.decision,
          approvalNotes: parsed.data.approvalNotes ?? null,
        },
      });

      res.json({ checklist: updated[0] });
    } catch (err) {
      console.error('Checklist approval failed:', err);
      res.status(500).json({ error: 'Failed to update checklist status.' });
    }
  }
);

apiRouter.post(
  '/checklists/:id/items',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        label: z.string().trim().min(4).max(300),
        guidance: z.string().trim().min(4).max(1000),
        isMandatory: z.boolean().default(true),
        allowFailEscalation: z.boolean().default(true),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Valid checklist step label and guidance required.' });
      return;
    }
    try {
      const checklistId = Number(req.params.id);
      const authUser = req.authUser!;
      const existing = await db
        .select()
        .from(diagnosticChecklists)
        .where(eq(diagnosticChecklists.id, checklistId))
        .limit(1);
      if (!existing[0]) {
        res.status(404).json({ error: 'Checklist not found.' });
        return;
      }
      const existingItems = await db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.checklistId, checklistId));

      const inserted = await db
        .insert(checklistItems)
        .values({
          checklistId,
          sortOrder: existingItems.length + 1,
          label: parsed.data.label,
          guidance: parsed.data.guidance,
          isMandatory: parsed.data.isMandatory,
          allowFailEscalation: parsed.data.allowFailEscalation,
        })
        .returning();

      await db
        .update(diagnosticChecklists)
        .set({ version: existing[0].version + 1 })
        .where(eq(diagnosticChecklists.id, checklistId));

      await recordAuditLog({
        actor: authUser,
        actionType: 'CHECKLIST_ITEM_ADDED',
        entityType: 'diagnostic_checklist',
        entityId: String(checklistId),
        details: { label: parsed.data.label },
      });

      res.status(201).json({ item: inserted[0] });
    } catch (err) {
      console.error('Failed to add checklist item:', err);
      res.status(500).json({ error: 'Failed to add checklist item.' });
    }
  }
);

apiRouter.get(
  '/admin/users',
  requireAuth,
  requireRole('platform_admin'),
  async (_req, res) => {
    try {
      const users = await db
        .select({
          id: appUsers.id,
          email: appUsers.email,
          name: appUsers.name,
          designation: appUsers.designation,
          role: appUsers.role,
          agentAlias: appUsers.agentAlias,
          hasGlobalClientAccess: appUsers.hasGlobalClientAccess,
          isActive: appUsers.isActive,
          createdAt: appUsers.createdAt,
        })
        .from(appUsers)
        .orderBy(asc(appUsers.id));

      const accesses = await db.select().from(userClientAccess);
      const accessMap = new Map<number, string[]>();
      for (const a of accesses) {
        const arr = accessMap.get(a.userId) ?? [];
        arr.push(a.clientId);
        accessMap.set(a.userId, arr);
      }

      res.json({
        users: users.map((u) => ({
          ...u,
          clientIds: u.hasGlobalClientAccess ? [] : (accessMap.get(u.id) ?? []),
        })),
      });
    } catch (err) {
      console.error('Failed to list users:', err);
      res.status(500).json({ error: 'Failed to load users.' });
    }
  }
);

apiRouter.post(
  '/admin/users',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        email: z.string().email(),
        name: z.string().trim().min(2).max(120),
        designation: z.string().trim().min(2).max(120),
        role: z.enum([
          'platform_admin',
          'support_manager',
          'engineering_manager',
          'support_agent',
        ]),
        agentAlias: z.string().max(80).nullable().optional(),
        hasGlobalClientAccess: z.boolean().default(true),
        password: z.string().min(6).optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid user payload.' });
      return;
    }

    try {
      const authUser = req.authUser!;
      const normalizedEmail = parsed.data.email.trim().toLowerCase();
      const existing = await db
        .select()
        .from(appUsers)
        .where(eq(appUsers.email, normalizedEmail))
        .limit(1);

      if (existing[0]) {
        res.status(409).json({ error: `User with email ${normalizedEmail} already exists.` });
        return;
      }

      const passwordHash = await bcrypt.hash(parsed.data.password || 'ResolveIQ!2026', 10);
      const inserted = await db
        .insert(appUsers)
        .values({
          email: normalizedEmail,
          name: parsed.data.name,
          designation: parsed.data.designation,
          role: parsed.data.role,
          agentAlias: parsed.data.agentAlias ?? null,
          passwordHash,
          hasGlobalClientAccess: parsed.data.hasGlobalClientAccess,
          isActive: true,
        })
        .returning({
          id: appUsers.id,
          email: appUsers.email,
          name: appUsers.name,
          designation: appUsers.designation,
          role: appUsers.role,
          hasGlobalClientAccess: appUsers.hasGlobalClientAccess,
          isActive: appUsers.isActive,
        });

      await recordAuditLog({
        actor: authUser,
        actionType: 'USER_CREATED',
        entityType: 'user',
        entityId: String(inserted[0].id),
        details: { email: normalizedEmail, role: parsed.data.role },
      });

      res.status(201).json({ user: inserted[0] });
    } catch (err) {
      console.error('Failed to create user:', err);
      res.status(500).json({ error: 'Failed to create user.' });
    }
  }
);

apiRouter.patch(
  '/admin/users/:id',
  requireAuth,
  requireRole('platform_admin'),
  async (req: AuthRequest, res) => {
    const parsed = z
      .object({
        role: z
          .enum([
            'platform_admin',
            'support_manager',
            'engineering_manager',
            'support_agent',
          ])
          .optional(),
        isActive: z.boolean().optional(),
        hasGlobalClientAccess: z.boolean().optional(),
        clientIds: z.array(z.string()).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid user update payload.' });
      return;
    }

    try {
      const targetUserId = Number(req.params.id);
      const authUser = req.authUser!;

      const existing = await db
        .select()
        .from(appUsers)
        .where(eq(appUsers.id, targetUserId))
        .limit(1);
      if (!existing[0]) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const updateFields: Partial<typeof appUsers.$inferInsert> = {};
      if (parsed.data.role !== undefined) updateFields.role = parsed.data.role as UserRole;
      if (parsed.data.isActive !== undefined) updateFields.isActive = parsed.data.isActive;
      if (parsed.data.hasGlobalClientAccess !== undefined) {
        updateFields.hasGlobalClientAccess = parsed.data.hasGlobalClientAccess;
      }

      if (Object.keys(updateFields).length > 0) {
        await db.update(appUsers).set(updateFields).where(eq(appUsers.id, targetUserId));
      }

      if (parsed.data.clientIds !== undefined) {
        await db
          .delete(userClientAccess)
          .where(eq(userClientAccess.userId, targetUserId));
        if (parsed.data.clientIds.length > 0) {
          await db
            .insert(userClientAccess)
            .values(
              parsed.data.clientIds.map((cid) => ({
                userId: targetUserId,
                clientId: cid,
                grantedByUserId: authUser.id,
              }))
            )
            .onConflictDoNothing();
        }
      }

      await recordAuditLog({
        actor: authUser,
        actionType: 'USER_ACCESS_UPDATED',
        entityType: 'user',
        entityId: String(targetUserId),
        details: {
          role: parsed.data.role ?? existing[0].role,
          isActive: parsed.data.isActive ?? existing[0].isActive,
          hasGlobalClientAccess:
            parsed.data.hasGlobalClientAccess ?? existing[0].hasGlobalClientAccess,
          scopedClientsCount: parsed.data.clientIds?.length,
        },
      });

      const updated = await hydrateAuthUserById(targetUserId);
      res.json({ user: updated });
    } catch (err) {
      console.error('Failed to update user access:', err);
      res.status(500).json({ error: 'Failed to update user access.' });
    }
  }
);

apiRouter.get('/clients', requireAuth, async (req: AuthRequest, res) => {
  try {
    const authUser = req.authUser!;
    const rows =
      authUser.hasGlobalClientAccess || authUser.accessibleClientIds === null
        ? await db.select().from(clients).orderBy(asc(clients.clientName))
        : authUser.accessibleClientIds.length === 0
          ? []
          : await db
              .select()
              .from(clients)
              .where(inArray(clients.clientId, authUser.accessibleClientIds))
              .orderBy(asc(clients.clientName));

    res.json({ clients: rows });
  } catch (err) {
    console.error('Failed to list clients:', err);
    res.status(500).json({ error: 'Failed to load clients.' });
  }
});

apiRouter.get(
  '/admin/audit-logs',
  requireAuth,
  requireRole('platform_admin', 'support_manager', 'engineering_manager'),
  async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(10, Number(req.query.limit || 80)));
      const ticketId =
        typeof req.query.ticketId === 'string' ? req.query.ticketId.trim() : '';

      const logs = ticketId
        ? await db
            .select()
            .from(auditLogs)
            .where(eq(auditLogs.ticketId, ticketId))
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit)
        : await db
            .select()
            .from(auditLogs)
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit);

      res.json({ logs });
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      res.status(500).json({ error: 'Failed to load audit logs.' });
    }
  }
);

// ---------------------------------------------------------------------------
// 8. Clean Source ZIP Export (Excludes secrets, node_modules, dist, .git)
// ---------------------------------------------------------------------------
apiRouter.get('/export/source-zip', requireAuth, (req, res) => {
  const rootDir = process.cwd();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="resolveiq-source.zip"');

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err: Error) => {
    console.error('ZIP archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create source ZIP.' });
    }
  });
  archive.pipe(res);

  const ignoreDirs = new Set([
    'node_modules',
    'dist',
    '.git',
    '.aistudio',
    '.next',
    'tmp',
  ]);
  const ignoreFiles = new Set(['.env', '.env.local', '.env.production', 'bun.lock']);

  function appendDir(currentDir: string, relPrefix: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        appendDir(
          path.join(currentDir, entry.name),
          relPrefix ? `${relPrefix}/${entry.name}` : entry.name
        );
      } else if (entry.isFile()) {
        if (
          ignoreFiles.has(entry.name) ||
          (entry.name.startsWith('.env') && entry.name !== '.env.example') ||
          entry.name.endsWith('.zip') ||
          entry.name.endsWith('.dump') ||
          entry.name.endsWith('.backup')
        ) continue;
        archive.file(path.join(currentDir, entry.name), {
          name: relPrefix ? `${relPrefix}/${entry.name}` : entry.name,
        });
      }
    }
  }

  appendDir(rootDir, '');
  archive.finalize().catch((err: unknown) => console.error('Finalize ZIP error:', err));
});
