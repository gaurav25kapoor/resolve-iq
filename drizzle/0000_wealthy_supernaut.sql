CREATE TABLE "ai_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_ticket_id" integer,
	"ticket_id" text NOT NULL,
	"retrieval_method" text NOT NULL,
	"similar_tickets_json" jsonb NOT NULL,
	"diagnosis_summary" text NOT NULL,
	"suggested_steps_json" jsonb NOT NULL,
	"draft_handoff_json" jsonb NOT NULL,
	"confidence_note" text NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"designation" text NOT NULL,
	"role" text NOT NULL,
	"agent_alias" text,
	"password_hash" text,
	"has_global_client_access" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_uid_unique" UNIQUE("uid"),
	CONSTRAINT "app_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_user_id" integer,
	"actor_name" text NOT NULL,
	"actor_role" text NOT NULL,
	"action_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"ticket_id" text,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"checklist_id" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"label" text NOT NULL,
	"guidance" text NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"allow_fail_escalation" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"client_tier" text NOT NULL,
	"sla_target_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"is_proposed_demo" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_by_user_id" integer,
	"approval_notes" text,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_checklists_category_unique" UNIQUE("category")
);
--> statement-breakpoint
CREATE TABLE "engineering_escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_ticket_id" integer NOT NULL,
	"ticket_id" text NOT NULL,
	"handoff_number" integer DEFAULT 1 NOT NULL,
	"submitted_by_user_id" integer NOT NULL,
	"problem_summary" text NOT NULL,
	"business_impact" text NOT NULL,
	"expected_behavior" text NOT NULL,
	"actual_behavior" text NOT NULL,
	"steps_performed" text NOT NULL,
	"diagnostic_evidence" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"eng_outcome" text,
	"return_reason" text,
	"eng_notes" text,
	"reviewed_by_user_id" integer,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "historical_tickets" (
	"ticket_id" text PRIMARY KEY NOT NULL,
	"created_at_raw" text NOT NULL,
	"created_at_ts" timestamp NOT NULL,
	"channel" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"client_tier" text NOT NULL,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"description" text NOT NULL,
	"assigned_agent" text NOT NULL,
	"first_response_at_raw" text,
	"first_response_at_ts" timestamp,
	"escalated_to_eng" boolean NOT NULL,
	"eng_ticket_id" text,
	"eng_handoffs" integer DEFAULT 0 NOT NULL,
	"eng_outcome" text,
	"status" text NOT NULL,
	"first_closed_at_raw" text,
	"first_closed_at_ts" timestamp,
	"final_closed_at_raw" text,
	"final_closed_at_ts" timestamp,
	"reopen_count" integer DEFAULT 0 NOT NULL,
	"csat_score" integer,
	"resolution_hours" double precision,
	"first_response_minutes" double precision,
	"search_text" text NOT NULL,
	"embedding_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "investigation_check_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_ticket_id" integer NOT NULL,
	"checklist_item_id" integer NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"evidence_ref" text DEFAULT '' NOT NULL,
	"updated_by_user_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_client_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"client_id" text NOT NULL,
	"granted_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"adopted_by_user_id" integer NOT NULL,
	"adopted_at" timestamp DEFAULT now() NOT NULL,
	"assigned_user_id" integer,
	"assigned_at" timestamp,
	"investigation_status" text DEFAULT 'adopted' NOT NULL,
	"investigation_notes" text DEFAULT '' NOT NULL,
	"evidence_summary" text DEFAULT '' NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_tickets_ticket_id_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_workflow_ticket_id_workflow_tickets_id_fk" FOREIGN KEY ("workflow_ticket_id") REFERENCES "public"."workflow_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_ticket_id_historical_tickets_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."historical_tickets"("ticket_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_created_by_user_id_app_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_app_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_diagnostic_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."diagnostic_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_checklists" ADD CONSTRAINT "diagnostic_checklists_approved_by_user_id_app_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_escalations" ADD CONSTRAINT "engineering_escalations_workflow_ticket_id_workflow_tickets_id_fk" FOREIGN KEY ("workflow_ticket_id") REFERENCES "public"."workflow_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_escalations" ADD CONSTRAINT "engineering_escalations_ticket_id_historical_tickets_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."historical_tickets"("ticket_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_escalations" ADD CONSTRAINT "engineering_escalations_submitted_by_user_id_app_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_escalations" ADD CONSTRAINT "engineering_escalations_reviewed_by_user_id_app_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_check_results" ADD CONSTRAINT "investigation_check_results_workflow_ticket_id_workflow_tickets_id_fk" FOREIGN KEY ("workflow_ticket_id") REFERENCES "public"."workflow_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_check_results" ADD CONSTRAINT "investigation_check_results_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_check_results" ADD CONSTRAINT "investigation_check_results_updated_by_user_id_app_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_access" ADD CONSTRAINT "user_client_access_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_access" ADD CONSTRAINT "user_client_access_client_id_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_access" ADD CONSTRAINT "user_client_access_granted_by_user_id_app_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tickets" ADD CONSTRAINT "workflow_tickets_ticket_id_historical_tickets_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."historical_tickets"("ticket_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tickets" ADD CONSTRAINT "workflow_tickets_adopted_by_user_id_app_users_id_fk" FOREIGN KEY ("adopted_by_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tickets" ADD CONSTRAINT "workflow_tickets_assigned_user_id_app_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."app_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_ticket_idx" ON "audit_logs" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "historical_tickets_category_idx" ON "historical_tickets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "historical_tickets_client_idx" ON "historical_tickets" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "historical_tickets_status_idx" ON "historical_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "historical_tickets_created_idx" ON "historical_tickets" USING btree ("created_at_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_check_workflow_item_idx" ON "investigation_check_results" USING btree ("workflow_ticket_id","checklist_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_client_access_user_client_idx" ON "user_client_access" USING btree ("user_id","client_id");