CREATE TABLE IF NOT EXISTS "automation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"message_id" text DEFAULT '' NOT NULL,
	"provider_message_id" text DEFAULT '' NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" text DEFAULT '{}' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "email_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"lead_id" text NOT NULL,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"kind" text DEFAULT 'first_contact' NOT NULL,
	"parent_message_id" text DEFAULT '' NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"content_text" text NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"intent" text DEFAULT '' NOT NULL,
	"risk_level" text DEFAULT 'normal' NOT NULL,
	"provider_message_id" text,
	"error_message" text,
	"reviewed_at" text,
	"sent_at" text,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "follow_up_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"lead_id" text NOT NULL,
	"root_message_id" text NOT NULL,
	"draft_message_id" text DEFAULT '' NOT NULL,
	"step_number" integer NOT NULL,
	"delay_days" integer NOT NULL,
	"due_at" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"category" text DEFAULT '产品资料' NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"object_key" text DEFAULT '' NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"content_type" text DEFAULT '' NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"file_data" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"company" text NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"products_json" text DEFAULT '[]' NOT NULL,
	"contact" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"socials_json" text DEFAULT '[]' NOT NULL,
	"contact_evidence_json" text DEFAULT '[]' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"stage" text DEFAULT '新发现' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"verified_at" text DEFAULT '' NOT NULL,
	"owner_id" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"order_no" text NOT NULL,
	"lead_id" text NOT NULL,
	"company" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total_minor" integer NOT NULL,
	"status" text DEFAULT '待确认' NOT NULL,
	"order_date" text NOT NULL,
	"due_date" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"order_id" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"paid_at" text NOT NULL,
	"method" text DEFAULT '银行转账' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"lead_id" text NOT NULL,
	"channel" text NOT NULL,
	"reason" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"reviewed_at" text
);

CREATE TABLE IF NOT EXISTS "search_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"provider" text DEFAULT 'demo' NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completed_at" text
);

CREATE TABLE IF NOT EXISTS "suppression_list" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text DEFAULT 'demo' NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_email_events_provider_created" ON "email_events" USING btree ("provider_message_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_email_messages_workspace_status_created" ON "email_messages" USING btree ("workspace_id","status","created_at");
CREATE INDEX IF NOT EXISTS "idx_email_messages_workspace_sent" ON "email_messages" USING btree ("workspace_id","sent_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_email_messages_provider_id" ON "email_messages" USING btree ("provider_message_id");
CREATE INDEX IF NOT EXISTS "idx_follow_up_plans_workspace_status_due" ON "follow_up_plans" USING btree ("workspace_id","status","due_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_follow_up_plans_root_step" ON "follow_up_plans" USING btree ("root_message_id","step_number");
CREATE INDEX IF NOT EXISTS "idx_leads_workspace_created" ON "leads" USING btree ("workspace_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_leads_workspace_stage" ON "leads" USING btree ("workspace_id","stage");
CREATE INDEX IF NOT EXISTS "idx_leads_workspace_email" ON "leads" USING btree ("workspace_id","email");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_orders_workspace_order_no" ON "orders" USING btree ("workspace_id","order_no");
CREATE INDEX IF NOT EXISTS "idx_orders_workspace_created" ON "orders" USING btree ("workspace_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_orders_workspace_due_status" ON "orders" USING btree ("workspace_id","due_date","status");
CREATE INDEX IF NOT EXISTS "idx_payments_workspace_order_created" ON "payments" USING btree ("workspace_id","order_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_payments_workspace_paid" ON "payments" USING btree ("workspace_id","paid_at");
CREATE INDEX IF NOT EXISTS "idx_review_items_workspace_status" ON "review_items" USING btree ("workspace_id","status");
CREATE INDEX IF NOT EXISTS "idx_search_jobs_workspace_created" ON "search_jobs" USING btree ("workspace_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_suppression_workspace_email" ON "suppression_list" USING btree ("workspace_id","email");
