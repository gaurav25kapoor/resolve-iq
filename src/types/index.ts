export type UserRole =
  | 'platform_admin'
  | 'support_manager'
  | 'engineering_manager'
  | 'support_agent';

export interface AuthUser {
  id: number;
  uid: string | null;
  email: string;
  name: string;
  designation: string;
  role: UserRole;
  agentAlias: string | null;
  hasGlobalClientAccess: boolean;
  accessibleClientIds: string[] | null;
}

export interface DemoPersona {
  id: number;
  email: string;
  name: string;
  designation: string;
  role: UserRole;
  agentAlias: string | null;
  hasGlobalClientAccess: boolean;
}

export interface EvidenceRef {
  label: string;
  type: string;
  value: string;
  addedBy: string;
  addedAt: string;
}

export interface TicketListItem {
  ticketId: string;
  createdAtRaw: string;
  channel: string;
  clientId: string;
  clientName: string;
  clientTier: string;
  category: string;
  priority: string;
  description: string;
  historicalAssignedAgent: string;
  escalatedToEng: boolean;
  engTicketId: string | null;
  engHandoffs: number;
  engOutcome: string | null;
  historicalStatus: string;
  reopenCount: number;
  csatScore: number | null;
  resolutionHours: number | null;
  workflow: {
    id: number;
    adoptedAt: string;
    assignedUserId: number | null;
    assignedUserName: string | null;
    assignedUserEmail: string | null;
    investigationStatus: string;
    updatedAt: string;
  } | null;
}

export interface ChecklistItemWithResult {
  id: number;
  sortOrder: number;
  label: string;
  guidance: string;
  isMandatory: boolean;
  allowFailEscalation: boolean;
  result: 'pending' | 'pass' | 'fail' | 'na';
  notes: string;
  evidenceRef: string;
  updatedAt: string | null;
}

export interface SimilarTicketItem {
  ticketId: string;
  similarityScore: number;
  category: string;
  priority: string;
  clientName: string;
  clientTier: string;
  description: string;
  escalatedToEng: boolean;
  engOutcome: string | null;
  engHandoffs: number;
  resolutionHours: number | null;
  csatScore: number | null;
  status: string;
}

export interface DraftHandoffPayload {
  problemSummary: string;
  businessImpact: string;
  expectedBehavior: string;
  actualBehavior: string;
  stepsPerformed: string;
  diagnosticEvidence: string;
}

export interface AiAnalysisResponse {
  ticketId: string;
  retrievalMethod: string;
  aiSynthesisMode: 'gemini-4-hydrogen' | 'deterministic-evidence-fallback';
  similarTickets: SimilarTicketItem[];
  diagnosisSummary: string;
  suggestedSteps: string[];
  draftHandoff: DraftHandoffPayload;
  confidenceNote: string;
  historicalPatternStats: {
    sampleCount: number;
    escalatedCount: number;
    fixedCount: number;
    insufficientInfoCount: number;
    configReturnCount: number;
    duplicateCount: number;
    notABugCount: number;
  };
}

export interface EscalationRecord {
  id: number;
  workflowTicketId: number;
  ticketId: string;
  handoffNumber: number;
  submittedByUserId: number;
  submittedByName: string;
  reviewedByUserId: number | null;
  reviewedByName: string | null;
  problemSummary: string;
  businessImpact: string;
  expectedBehavior: string;
  actualBehavior: string;
  stepsPerformed: string;
  diagnosticEvidence: string;
  status: 'submitted' | 'under_review' | 'returned_to_l1' | 'outcome_recorded';
  engOutcome: string | null;
  returnReason: string | null;
  engNotes: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  category?: string;
  priority?: string;
  clientId?: string;
  clientName?: string;
  clientTier?: string;
  description?: string;
  investigationNotes?: string;
  evidenceSummary?: string;
  evidenceRefs?: EvidenceRef[];
  checklistTitle?: string | null;
  checklistResults?: Array<{
    itemId: number;
    label: string;
    result: string;
    notes: string;
    evidenceRef: string;
  }>;
}

export interface FullTicketDetail {
  historical: {
    ticketId: string;
    createdAtRaw: string;
    channel: string;
    clientId: string;
    clientName: string;
    clientTier: string;
    category: string;
    priority: string;
    description: string;
    assignedAgent: string;
    firstResponseAtRaw: string | null;
    escalatedToEng: boolean;
    engTicketId: string | null;
    engHandoffs: number;
    engOutcome: string | null;
    status: string;
    firstClosedAtRaw: string | null;
    finalClosedAtRaw: string | null;
    reopenCount: number;
    csatScore: number | null;
    resolutionHours: number | null;
    firstResponseMinutes: number | null;
  };
  workflow: {
    id: number;
    ticketId: string;
    adoptedByName: string;
    adoptedAt: string;
    assignedUserId: number | null;
    assignedUserName: string | null;
    assignedUserEmail: string | null;
    assignedAt: string | null;
    investigationStatus: string;
    investigationNotes: string;
    evidenceSummary: string;
    evidenceRefs: EvidenceRef[];
    updatedAt: string;
  } | null;
  checklist: {
    id: number;
    category: string;
    title: string;
    description: string;
    isProposedDemo: boolean;
    status: 'pending_approval' | 'approved' | 'rejected';
    version: number;
    approvedByName: string | null;
    approvedAt: string | null;
    approvalNotes: string | null;
    items: ChecklistItemWithResult[];
  } | null;
  escalations: EscalationRecord[];
  latestAiAnalysis: {
    id: number;
    retrievalMethod: string;
    similarTicketsJson: SimilarTicketItem[];
    diagnosisSummary: string;
    suggestedStepsJson: string[];
    draftHandoffJson: DraftHandoffPayload;
    confidenceNote: string;
    createdAt: string;
  } | null;
  auditTrail: Array<{
    id: number;
    actorName: string;
    actorRole: string;
    actionType: string;
    entityType: string;
    entityId: string;
    ticketId: string | null;
    detailsJson: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface HistoricalAnalyticsData {
  dataBoundary: {
    source: string;
    snapshotDate: string;
    limitations: string[];
  };
  kpis: {
    totalTickets: number;
    uniqueClients: number;
    closedCount: number;
    openSnapshotCount: number;
    openWithL1: number;
    openWithEng: number;
    escalatedCount: number;
    escalationRate: number;
    insufficientInfoReturns: number;
    insufficientInfoShareOfEscPct: number;
    configReturns: number;
    configReturnShareOfEscPct: number;
    duplicateReturns: number;
    notABugReturns: number;
    multiHandoffCount: number;
    csatRatedCount: number;
    csatMissingCount: number;
    csatCoveragePct: number;
    avgCsat: number | null;
    resolutionTimeStats: {
      overallMeanHours: number | null;
      overallMedianHours: number | null;
      overallP90Hours: number | null;
      escalatedMeanHours: number | null;
      escalatedMedianHours: number | null;
      nonEscalatedMeanHours: number | null;
      nonEscalatedMedianHours: number | null;
    };
  };
  monthlyArrivals: Array<{
    month: string;
    arrivals: number;
    escalated: number;
    nonEscalated: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    total: number;
    escalated: number;
    escalationRate: number;
    insufficientInfoReturns: number;
    configReturns: number;
    fixedCount: number;
    medianResolutionHours: number | null;
    avgCsat: number | null;
    csatCount: number;
  }>;
  priorityDistribution: Array<{
    priority: string;
    total: number;
    escalated: number;
    escalationRate: number;
    medianResolutionHours: number | null;
  }>;
  channelDistribution: Array<{ channel: string; count: number }>;
  clientTierDistribution: Array<{
    tier: string;
    total: number;
    escalated: number;
    escalationRate: number;
  }>;
  topClients: Array<{
    clientId: string;
    clientName: string;
    clientTier: string;
    total: number;
    escalated: number;
    escalationRate: number;
    openCount: number;
    avgCsat: number | null;
  }>;
  engineeringOutcomes: Array<{
    outcome: string;
    count: number;
    shareOfEscalatedPct: number;
  }>;
  resolutionTimeDistribution: Array<{
    bucket: string;
    nonEscalated: number;
    escalated: number;
  }>;
  csatByResolutionBucket: Array<{
    bucket: string;
    ratedCount: number;
    avgCsat: number | null;
    escalatedSharePct: number;
  }>;
  historicalAgents: Array<{
    agent: string;
    total: number;
    escalated: number;
    escalationRate: number;
    avgCsat: number | null;
  }>;
}

export interface LiveAnalyticsData {
  dataBoundary: {
    source: string;
    note: string;
  };
  adoptedTotal: number;
  assignedTotal: number;
  statusCounts: Record<string, number>;
  checklistResultsSummary: {
    totalRecorded: number;
    pass: number;
    fail: number;
    na: number;
    pending: number;
  };
  checklistGovernance: {
    total: number;
    approved: number;
    pendingApproval: number;
    rejected: number;
  };
  escalationsSummary: {
    totalSubmissions: number;
    awaitingReview: number;
    returnedToL1: number;
    outcomeRecorded: number;
    byOutcome: Array<{ outcome: string; count: number }>;
  };
}
