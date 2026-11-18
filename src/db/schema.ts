import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export interface EvidenceRefItem {
  label: string;
  type: string;
  value: string;
  addedBy: string;
  addedAt: string;
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

export interface HistoricalSourceFields {
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

export const appUsers = pgTable('app_users', {
  id: serial('id').primaryKey(),
  uid: text('uid').unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  designation: text('designation').notNull(),
  role: text('role').notNull(), // 'platform_admin' | 'support_manager' | 'engineering_manager' | 'support_agent'
  agentAlias: text('agent_alias'),
  passwordHash: text('password_hash'),
  hasGlobalClientAccess: boolean('has_global_client_access').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const clients = pgTable('clients', {
  clientId: text('client_id').primaryKey(),
  clientName: text('client_name').notNull(),
  clientTier: text('client_tier').notNull(),
  slaTargetHours: integer('sla_target_hours').notNull().default(24),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userClientAccess = pgTable(
  'user_client_access',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => appUsers.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: text('client_id')
      .references(() => clients.clientId, { onDelete: 'cascade' })
      .notNull(),
    grantedByUserId: integer('granted_by_user_id').references(() => appUsers.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_client_access_user_client_idx').on(table.userId, table.clientId),
  ]
);

export const historicalTickets = pgTable(
  'historical_tickets',
  {
    ticketId: text('ticket_id').primaryKey(),
    createdAtRaw: text('created_at_raw').notNull(),
    createdAtTs: timestamp('created_at_ts').notNull(),
    channel: text('channel').notNull(),
    clientId: text('client_id')
      .references(() => clients.clientId, { onDelete: 'restrict' })
      .notNull(),
    clientName: text('client_name').notNull(),
    clientTier: text('client_tier').notNull(),
    category: text('category').notNull(),
    priority: text('priority').notNull(),
    description: text('description').notNull(),
    assignedAgent: text('assigned_agent').notNull(),
    firstResponseAtRaw: text('first_response_at_raw'),
    firstResponseAtTs: timestamp('first_response_at_ts'),
    escalatedToEng: boolean('escalated_to_eng').notNull(),
    engTicketId: text('eng_ticket_id'),
    engHandoffs: integer('eng_handoffs').notNull().default(0),
    engOutcome: text('eng_outcome'),
    status: text('status').notNull(),
    firstClosedAtRaw: text('first_closed_at_raw'),
    firstClosedAtTs: timestamp('first_closed_at_ts'),
    finalClosedAtRaw: text('final_closed_at_raw'),
    finalClosedAtTs: timestamp('final_closed_at_ts'),
    reopenCount: integer('reopen_count').notNull().default(0),
    csatScore: integer('csat_score'),
    resolutionHours: doublePrecision('resolution_hours'),
    firstResponseMinutes: doublePrecision('first_response_minutes'),
    searchText: text('search_text').notNull(),
    embeddingJson: jsonb('embedding_json').$type<number[] | null>(),
    // Exact decoded source CSV values, including empty strings and original formatting.
    sourceFields: jsonb('source_fields')
      .$type<Partial<HistoricalSourceFields>>()
      .notNull()
      .default({}),
  },
  (table) => [
    index('historical_tickets_category_idx').on(table.category),
    index('historical_tickets_client_idx').on(table.clientId),
    index('historical_tickets_status_idx').on(table.status),
    index('historical_tickets_created_idx').on(table.createdAtTs),
  ]
);

export const diagnosticChecklists = pgTable('diagnostic_checklists', {
  id: serial('id').primaryKey(),
  category: text('category').notNull().unique(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  isProposedDemo: boolean('is_proposed_demo').notNull().default(true),
  status: text('status').notNull().default('pending_approval'), // 'pending_approval' | 'approved' | 'rejected'
  version: integer('version').notNull().default(1),
  approvedByUserId: integer('approved_by_user_id').references(() => appUsers.id),
  approvalNotes: text('approval_notes'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const checklistItems = pgTable('checklist_items', {
  id: serial('id').primaryKey(),
  checklistId: integer('checklist_id')
    .references(() => diagnosticChecklists.id, { onDelete: 'cascade' })
    .notNull(),
  sortOrder: integer('sort_order').notNull(),
  label: text('label').notNull(),
  guidance: text('guidance').notNull(),
  isMandatory: boolean('is_mandatory').notNull().default(true),
  allowFailEscalation: boolean('allow_fail_escalation').notNull().default(true),
});

export const workflowTickets = pgTable('workflow_tickets', {
  id: serial('id').primaryKey(),
  ticketId: text('ticket_id')
    .references(() => historicalTickets.ticketId)
    .notNull()
    .unique(),
  adoptedByUserId: integer('adopted_by_user_id')
    .references(() => appUsers.id)
    .notNull(),
  adoptedAt: timestamp('adopted_at').defaultNow().notNull(),
  assignedUserId: integer('assigned_user_id').references(() => appUsers.id),
  assignedAt: timestamp('assigned_at'),
  investigationStatus: text('investigation_status').notNull().default('adopted'),
  investigationNotes: text('investigation_notes').notNull().default(''),
  evidenceSummary: text('evidence_summary').notNull().default(''),
  evidenceRefs: jsonb('evidence_refs').$type<EvidenceRefItem[]>().notNull().default([]),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const investigationCheckResults = pgTable(
  'investigation_check_results',
  {
    id: serial('id').primaryKey(),
    workflowTicketId: integer('workflow_ticket_id')
      .references(() => workflowTickets.id, { onDelete: 'cascade' })
      .notNull(),
    checklistItemId: integer('checklist_item_id')
      .references(() => checklistItems.id, { onDelete: 'cascade' })
      .notNull(),
    result: text('result').notNull().default('pending'), // 'pending' | 'pass' | 'fail' | 'na'
    notes: text('notes').notNull().default(''),
    evidenceRef: text('evidence_ref').notNull().default(''),
    updatedByUserId: integer('updated_by_user_id').references(() => appUsers.id),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('inv_check_workflow_item_idx').on(
      table.workflowTicketId,
      table.checklistItemId
    ),
  ]
);

export const aiAnalyses = pgTable('ai_analyses', {
  id: serial('id').primaryKey(),
  workflowTicketId: integer('workflow_ticket_id').references(() => workflowTickets.id, {
    onDelete: 'set null',
  }),
  ticketId: text('ticket_id')
    .references(() => historicalTickets.ticketId)
    .notNull(),
  retrievalMethod: text('retrieval_method').notNull(),
  similarTicketsJson: jsonb('similar_tickets_json').$type<SimilarTicketItem[]>().notNull(),
  diagnosisSummary: text('diagnosis_summary').notNull(),
  suggestedStepsJson: jsonb('suggested_steps_json').$type<string[]>().notNull(),
  draftHandoffJson: jsonb('draft_handoff_json').$type<DraftHandoffPayload>().notNull(),
  confidenceNote: text('confidence_note').notNull(),
  createdByUserId: integer('created_by_user_id').references(() => appUsers.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const engineeringEscalations = pgTable('engineering_escalations', {
  id: serial('id').primaryKey(),
  workflowTicketId: integer('workflow_ticket_id')
    .references(() => workflowTickets.id, { onDelete: 'cascade' })
    .notNull(),
  ticketId: text('ticket_id')
    .references(() => historicalTickets.ticketId)
    .notNull(),
  handoffNumber: integer('handoff_number').notNull().default(1),
  submittedByUserId: integer('submitted_by_user_id')
    .references(() => appUsers.id)
    .notNull(),
  problemSummary: text('problem_summary').notNull(),
  businessImpact: text('business_impact').notNull(),
  expectedBehavior: text('expected_behavior').notNull(),
  actualBehavior: text('actual_behavior').notNull(),
  stepsPerformed: text('steps_performed').notNull(),
  diagnosticEvidence: text('diagnostic_evidence').notNull(),
  status: text('status').notNull().default('submitted'), // 'submitted' | 'under_review' | 'returned_to_l1' | 'outcome_recorded'
  engOutcome: text('eng_outcome'),
  returnReason: text('return_reason'),
  engNotes: text('eng_notes'),
  reviewedByUserId: integer('reviewed_by_user_id').references(() => appUsers.id),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at'),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => appUsers.id),
    actorName: text('actor_name').notNull(),
    actorRole: text('actor_role').notNull(),
    actionType: text('action_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    ticketId: text('ticket_id'),
    detailsJson: jsonb('details_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_created_idx').on(table.createdAt),
    index('audit_logs_ticket_idx').on(table.ticketId),
  ]
);

export const appUsersRelations = relations(appUsers, ({ many }) => ({
  clientAccess: many(userClientAccess),
  adoptedTickets: many(workflowTickets, { relationName: 'adoptedBy' }),
  assignedTickets: many(workflowTickets, { relationName: 'assignedTo' }),
}));

export const diagnosticChecklistsRelations = relations(diagnosticChecklists, ({ many, one }) => ({
  items: many(checklistItems),
  approvedBy: one(appUsers, {
    fields: [diagnosticChecklists.approvedByUserId],
    references: [appUsers.id],
  }),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  checklist: one(diagnosticChecklists, {
    fields: [checklistItems.checklistId],
    references: [diagnosticChecklists.id],
  }),
}));

export const workflowTicketsRelations = relations(workflowTickets, ({ one, many }) => ({
  historicalTicket: one(historicalTickets, {
    fields: [workflowTickets.ticketId],
    references: [historicalTickets.ticketId],
  }),
  adoptedBy: one(appUsers, {
    fields: [workflowTickets.adoptedByUserId],
    references: [appUsers.id],
    relationName: 'adoptedBy',
  }),
  assignedTo: one(appUsers, {
    fields: [workflowTickets.assignedUserId],
    references: [appUsers.id],
    relationName: 'assignedTo',
  }),
  checkResults: many(investigationCheckResults),
  escalations: many(engineeringEscalations),
}));
