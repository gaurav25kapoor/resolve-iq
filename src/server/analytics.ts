import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  diagnosticChecklists,
  engineeringEscalations,
  historicalTickets,
  investigationCheckResults,
  workflowTickets,
} from '../db/schema.ts';

export interface HistoricalFilterParams {
  startDate?: string;
  endDate?: string;
  category?: string;
  clientTier?: string;
  channel?: string;
  accessibleClientIds?: string[] | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  }
  return Math.round(sorted[mid] * 100) / 100;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return Math.round(sorted[idx] * 100) / 100;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((acc, v) => acc + v, 0);
  return Math.round((total / values.length) * 100) / 100;
}

export async function computeHistoricalAnalytics(filters: HistoricalFilterParams) {
  const conditions = [];

  if (filters.startDate) {
    const d = new Date(`${filters.startDate}T00:00:00+05:30`);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(gte(historicalTickets.createdAtTs, d));
    }
  }
  if (filters.endDate) {
    const d = new Date(`${filters.endDate}T23:59:59+05:30`);
    if (!Number.isNaN(d.getTime())) {
      conditions.push(lte(historicalTickets.createdAtTs, d));
    }
  }
  if (filters.category && filters.category !== 'ALL') {
    conditions.push(eq(historicalTickets.category, filters.category));
  }
  if (filters.clientTier && filters.clientTier !== 'ALL') {
    conditions.push(eq(historicalTickets.clientTier, filters.clientTier));
  }
  if (filters.channel && filters.channel !== 'ALL') {
    conditions.push(eq(historicalTickets.channel, filters.channel));
  }
  if (filters.accessibleClientIds !== null && filters.accessibleClientIds !== undefined) {
    if (filters.accessibleClientIds.length === 0) {
      conditions.push(eq(historicalTickets.clientId, '__NONE__'));
    } else {
      conditions.push(inArray(historicalTickets.clientId, filters.accessibleClientIds));
    }
  }

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(historicalTickets)
          .where(and(...conditions))
      : await db.select().from(historicalTickets);

  const totalTickets = rows.length;
  const uniqueClients = new Set(rows.map((r) => r.clientId)).size;
  const openTickets = rows.filter((r) => r.status !== 'Closed');
  const openWithL1 = rows.filter((r) => r.status === 'Open - with L1').length;
  const openWithEng = rows.filter((r) => r.status === 'Open - with Engineering').length;
  const closedTickets = rows.filter((r) => r.status === 'Closed');

  const escalatedRows = rows.filter((r) => r.escalatedToEng);
  const nonEscalatedRows = rows.filter((r) => !r.escalatedToEng);

  const escalationRate =
    totalTickets > 0
      ? Math.round((escalatedRows.length / totalTickets) * 1000) / 10
      : 0;

  // Monthly arrival trend (created_at_raw starts with YYYY-MM)
  const monthlyMap = new Map<
    string,
    { month: string; arrivals: number; escalated: number; nonEscalated: number }
  >();
  for (const r of rows) {
    const month = r.createdAtRaw.slice(0, 7);
    const entry = monthlyMap.get(month) ?? {
      month,
      arrivals: 0,
      escalated: 0,
      nonEscalated: 0,
    };
    entry.arrivals += 1;
    if (r.escalatedToEng) entry.escalated += 1;
    else entry.nonEscalated += 1;
    monthlyMap.set(month, entry);
  }
  const monthlyArrivals = Array.from(monthlyMap.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );

  // Category distribution & escalation rates
  const catMap = new Map<
    string,
    {
      category: string;
      total: number;
      escalated: number;
      insufficientInfoReturns: number;
      configReturns: number;
      fixedCount: number;
      resolutionHours: number[];
      csatScores: number[];
    }
  >();

  for (const r of rows) {
    const entry = catMap.get(r.category) ?? {
      category: r.category,
      total: 0,
      escalated: 0,
      insufficientInfoReturns: 0,
      configReturns: 0,
      fixedCount: 0,
      resolutionHours: [],
      csatScores: [],
    };
    entry.total += 1;
    if (r.escalatedToEng) entry.escalated += 1;
    if (r.engOutcome === 'Insufficient info - returned to L1') {
      entry.insufficientInfoReturns += 1;
    }
    if (r.engOutcome === 'Config issue - returned to L1') {
      entry.configReturns += 1;
    }
    if (r.engOutcome === 'Fixed') {
      entry.fixedCount += 1;
    }
    if (r.resolutionHours !== null) {
      entry.resolutionHours.push(r.resolutionHours);
    }
    if (r.csatScore !== null) {
      entry.csatScores.push(r.csatScore);
    }
    catMap.set(r.category, entry);
  }

  const categoryBreakdown = Array.from(catMap.values())
    .map((c) => ({
      category: c.category,
      total: c.total,
      escalated: c.escalated,
      escalationRate: c.total > 0 ? Math.round((c.escalated / c.total) * 1000) / 10 : 0,
      insufficientInfoReturns: c.insufficientInfoReturns,
      configReturns: c.configReturns,
      fixedCount: c.fixedCount,
      medianResolutionHours: median(c.resolutionHours),
      avgCsat: mean(c.csatScores),
      csatCount: c.csatScores.length,
    }))
    .sort((a, b) => b.total - a.total);

  // Priority distribution
  const priorityOrder = ['P1', 'P2', 'P3', 'P4'];
  const priorityDistribution = priorityOrder.map((p) => {
    const subset = rows.filter((r) => r.priority === p);
    const esc = subset.filter((r) => r.escalatedToEng).length;
    return {
      priority: p,
      total: subset.length,
      escalated: esc,
      escalationRate:
        subset.length > 0 ? Math.round((esc / subset.length) * 1000) / 10 : 0,
      medianResolutionHours: median(
        subset.map((s) => s.resolutionHours).filter((v): v is number => v !== null)
      ),
    };
  });

  // Channel distribution
  const channelMap = new Map<string, number>();
  for (const r of rows) {
    channelMap.set(r.channel, (channelMap.get(r.channel) ?? 0) + 1);
  }
  const channelDistribution = Array.from(channelMap.entries())
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  // Client tier distribution
  const tierMap = new Map<string, { tier: string; total: number; escalated: number }>();
  for (const r of rows) {
    const entry = tierMap.get(r.clientTier) ?? {
      tier: r.clientTier,
      total: 0,
      escalated: 0,
    };
    entry.total += 1;
    if (r.escalatedToEng) entry.escalated += 1;
    tierMap.set(r.clientTier, entry);
  }
  const clientTierDistribution = Array.from(tierMap.values()).map((t) => ({
    ...t,
    escalationRate: t.total > 0 ? Math.round((t.escalated / t.total) * 1000) / 10 : 0,
  }));

  // Client-level top distribution
  const clientAggMap = new Map<
    string,
    {
      clientId: string;
      clientName: string;
      clientTier: string;
      total: number;
      escalated: number;
      openCount: number;
      csatScores: number[];
    }
  >();
  for (const r of rows) {
    const entry = clientAggMap.get(r.clientId) ?? {
      clientId: r.clientId,
      clientName: r.clientName,
      clientTier: r.clientTier,
      total: 0,
      escalated: 0,
      openCount: 0,
      csatScores: [],
    };
    entry.total += 1;
    if (r.escalatedToEng) entry.escalated += 1;
    if (r.status !== 'Closed') entry.openCount += 1;
    if (r.csatScore !== null) entry.csatScores.push(r.csatScore);
    clientAggMap.set(r.clientId, entry);
  }
  const topClients = Array.from(clientAggMap.values())
    .map((c) => ({
      clientId: c.clientId,
      clientName: c.clientName,
      clientTier: c.clientTier,
      total: c.total,
      escalated: c.escalated,
      escalationRate: c.total > 0 ? Math.round((c.escalated / c.total) * 1000) / 10 : 0,
      openCount: c.openCount,
      avgCsat: mean(c.csatScores),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  // Engineering outcomes (across escalated tickets)
  const outcomeMap = new Map<string, number>();
  for (const r of escalatedRows) {
    const key = r.engOutcome || 'Pending / Unspecified';
    outcomeMap.set(key, (outcomeMap.get(key) ?? 0) + 1);
  }
  const engineeringOutcomes = Array.from(outcomeMap.entries())
    .map(([outcome, count]) => ({
      outcome,
      count,
      shareOfEscalatedPct:
        escalatedRows.length > 0
          ? Math.round((count / escalatedRows.length) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const insufficientInfoReturns = escalatedRows.filter(
    (r) => r.engOutcome === 'Insufficient info - returned to L1'
  ).length;
  const configReturns = escalatedRows.filter(
    (r) => r.engOutcome === 'Config issue - returned to L1'
  ).length;
  const duplicateReturns = escalatedRows.filter(
    (r) => r.engOutcome === 'Duplicate of known issue'
  ).length;
  const notABugReturns = escalatedRows.filter(
    (r) => r.engOutcome === 'Not a bug - how-to'
  ).length;
  const multiHandoffCount = escalatedRows.filter((r) => r.engHandoffs > 1).length;

  // Resolution time distributions (exclude open tickets with null resolutionHours)
  const allResHours = closedTickets
    .map((r) => r.resolutionHours)
    .filter((v): v is number => v !== null);
  const escResHours = escalatedRows
    .filter((r) => r.resolutionHours !== null)
    .map((r) => r.resolutionHours as number);
  const nonEscResHours = nonEscalatedRows
    .filter((r) => r.resolutionHours !== null)
    .map((r) => r.resolutionHours as number);

  const resBuckets = [
    { label: '< 4h', min: 0, max: 4 },
    { label: '4–12h', min: 4, max: 12 },
    { label: '12–24h', min: 12, max: 24 },
    { label: '24–72h', min: 24, max: 72 },
    { label: '72–120h', min: 72, max: 120 },
    { label: '120h+', min: 120, max: Infinity },
  ];

  const resolutionTimeDistribution = resBuckets.map((b) => ({
    bucket: b.label,
    nonEscalated: nonEscResHours.filter((h) => h >= b.min && h < b.max).length,
    escalated: escResHours.filter((h) => h >= b.min && h < b.max).length,
  }));

  // CSAT coverage & relationship to resolution time (strictly non-null csatScore)
  const csatRated = rows.filter((r) => r.csatScore !== null);
  const csatCoveragePct =
    totalTickets > 0 ? Math.round((csatRated.length / totalTickets) * 1000) / 10 : 0;
  const avgCsat = mean(csatRated.map((r) => r.csatScore as number));

  const csatByResolutionBucket = resBuckets.map((b) => {
    const subset = csatRated.filter(
      (r) => r.resolutionHours !== null && r.resolutionHours >= b.min && r.resolutionHours < b.max
    );
    return {
      bucket: b.label,
      ratedCount: subset.length,
      avgCsat: mean(subset.map((r) => r.csatScore as number)),
      escalatedSharePct:
        subset.length > 0
          ? Math.round(
              (subset.filter((r) => r.escalatedToEng).length / subset.length) * 1000
            ) / 10
          : 0,
    };
  });

  // Historical L1 Agent load (note: factual volume/escalation rates from CSV, not invented activities)
  const agentMap = new Map<
    string,
    { agent: string; total: number; escalated: number; csatScores: number[] }
  >();
  for (const r of rows) {
    const entry = agentMap.get(r.assignedAgent) ?? {
      agent: r.assignedAgent,
      total: 0,
      escalated: 0,
      csatScores: [],
    };
    entry.total += 1;
    if (r.escalatedToEng) entry.escalated += 1;
    if (r.csatScore !== null) entry.csatScores.push(r.csatScore);
    agentMap.set(r.assignedAgent, entry);
  }
  const historicalAgents = Array.from(agentMap.values())
    .map((a) => ({
      agent: a.agent,
      total: a.total,
      escalated: a.escalated,
      escalationRate: a.total > 0 ? Math.round((a.escalated / a.total) * 1000) / 10 : 0,
      avgCsat: mean(a.csatScores),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    dataBoundary: {
      source: 'rideops_support_tickets.csv (Historical Snapshot: Jul 2 – Sep 30, 2026)',
      snapshotDate: '2026-09-30',
      limitations: [
        'Single open-ticket snapshot as of Sep 30, 2026: historical backlog growth cannot be computed.',
        'Monthly ticket arrivals (Jul to Sep) represent intake volume, not backlog accumulation.',
        'Missing CSAT scores (blank in CSV) are excluded from CSAT averages and never treated as zero.',
        'Correlation between longer resolution time and lower CSAT does not establish causation.',
        'Historical records omit L1 troubleshooting transcripts; not all insufficient-info or config returns can be assumed avoidable.',
      ],
    },
    kpis: {
      totalTickets,
      uniqueClients,
      closedCount: closedTickets.length,
      openSnapshotCount: openTickets.length,
      openWithL1,
      openWithEng,
      escalatedCount: escalatedRows.length,
      escalationRate,
      insufficientInfoReturns,
      insufficientInfoShareOfEscPct:
        escalatedRows.length > 0
          ? Math.round((insufficientInfoReturns / escalatedRows.length) * 1000) / 10
          : 0,
      configReturns,
      configReturnShareOfEscPct:
        escalatedRows.length > 0
          ? Math.round((configReturns / escalatedRows.length) * 1000) / 10
          : 0,
      duplicateReturns,
      notABugReturns,
      multiHandoffCount,
      csatRatedCount: csatRated.length,
      csatMissingCount: totalTickets - csatRated.length,
      csatCoveragePct,
      avgCsat,
      resolutionTimeStats: {
        overallMeanHours: mean(allResHours),
        overallMedianHours: median(allResHours),
        overallP90Hours: percentile(allResHours, 90),
        escalatedMeanHours: mean(escResHours),
        escalatedMedianHours: median(escResHours),
        nonEscalatedMeanHours: mean(nonEscResHours),
        nonEscalatedMedianHours: median(nonEscResHours),
      },
    },
    monthlyArrivals,
    categoryBreakdown,
    priorityDistribution,
    channelDistribution,
    clientTierDistribution,
    topClients,
    engineeringOutcomes,
    resolutionTimeDistribution,
    csatByResolutionBucket,
    historicalAgents,
  };
}

export async function computeLiveWorkflowAnalytics(accessibleClientIds?: string[] | null) {
  const wfRows = await db.select().from(workflowTickets);
  const allHist = await db.select().from(historicalTickets);
  const histMap = new Map(allHist.map((h) => [h.ticketId, h]));

  const scopedWorkflows = wfRows.filter((w) => {
    if (accessibleClientIds === null || accessibleClientIds === undefined) return true;
    const h = histMap.get(w.ticketId);
    return h ? accessibleClientIds.includes(h.clientId) : false;
  });

  const wfIds = new Set(scopedWorkflows.map((w) => w.id));
  const escalations = (await db.select().from(engineeringEscalations)).filter((e) =>
    wfIds.has(e.workflowTicketId)
  );
  const checklists = await db.select().from(diagnosticChecklists);
  const checkResults = (await db.select().from(investigationCheckResults)).filter((c) =>
    wfIds.has(c.workflowTicketId)
  );

  const statusCounts = {
    adopted: 0,
    in_progress: 0,
    ready_for_escalation: 0,
    escalated: 0,
    returned_to_l1: 0,
    resolved_l1: 0,
    closed: 0,
  };
  for (const w of scopedWorkflows) {
    const key = w.investigationStatus as keyof typeof statusCounts;
    if (key in statusCounts) statusCounts[key] += 1;
  }

  const checklistGovernance = {
    total: checklists.length,
    approved: checklists.filter((c) => c.status === 'approved').length,
    pendingApproval: checklists.filter((c) => c.status === 'pending_approval').length,
    rejected: checklists.filter((c) => c.status === 'rejected').length,
  };

  const escalationOutcomesMap = new Map<string, number>();
  for (const e of escalations) {
    const key = e.engOutcome ?? (e.status === 'returned_to_l1' ? 'Returned to L1 (Pending)' : 'Awaiting Engineering Review');
    escalationOutcomesMap.set(key, (escalationOutcomesMap.get(key) ?? 0) + 1);
  }

  return {
    dataBoundary: {
      source: 'ResolveIQ Live Application Workflow Tables (PostgreSQL)',
      note: 'Strictly separated from immutable historical CSV metrics.',
    },
    adoptedTotal: scopedWorkflows.length,
    assignedTotal: scopedWorkflows.filter((w) => w.assignedUserId !== null).length,
    statusCounts,
    checklistResultsSummary: {
      totalRecorded: checkResults.length,
      pass: checkResults.filter((r) => r.result === 'pass').length,
      fail: checkResults.filter((r) => r.result === 'fail').length,
      na: checkResults.filter((r) => r.result === 'na').length,
      pending: checkResults.filter((r) => r.result === 'pending').length,
    },
    checklistGovernance,
    escalationsSummary: {
      totalSubmissions: escalations.length,
      awaitingReview: escalations.filter(
        (e) => e.status === 'submitted' || e.status === 'under_review'
      ).length,
      returnedToL1: escalations.filter((e) => e.status === 'returned_to_l1').length,
      outcomeRecorded: escalations.filter((e) => e.status === 'outcome_recorded').length,
      byOutcome: Array.from(escalationOutcomesMap.entries()).map(([outcome, count]) => ({
        outcome,
        count,
      })),
    },
  };
}
