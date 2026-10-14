ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS task_type text DEFAULT 'add_contact' NOT NULL;
ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'manual' NOT NULL;
ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS next_run_at text;
ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS last_run_at text;
ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_workspace_type_status ON automation_tasks (workspace_id, task_type, status);
CREATE INDEX IF NOT EXISTS idx_automation_workspace_next_run ON automation_tasks (workspace_id, next_run_at);

ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS library_type text DEFAULT 'knowledge' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_knowledge_workspace_library_status ON knowledge_sources (workspace_id, library_type, status);

ALTER TABLE review_items ADD COLUMN IF NOT EXISTS message_id text DEFAULT '' NOT NULL;
ALTER TABLE review_items ADD COLUMN IF NOT EXISTS metadata_json text DEFAULT '{}' NOT NULL;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_evidence_json text DEFAULT '[]' NOT NULL;

CREATE TABLE IF NOT EXISTS channel_messages (
  id text PRIMARY KEY,
  workspace_id text DEFAULT 'demo' NOT NULL,
  task_id text DEFAULT '' NOT NULL,
  lead_id text DEFAULT '' NOT NULL,
  direction text NOT NULL,
  kind text NOT NULL,
  contact text DEFAULT '' NOT NULL,
  content text NOT NULL,
  status text DEFAULT 'queued' NOT NULL,
  risk_level text DEFAULT 'normal' NOT NULL,
  sensitive_words_json text DEFAULT '[]' NOT NULL,
  metadata_json text DEFAULT '{}' NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channel_messages_workspace_status_created ON channel_messages (workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_messages_task_created ON channel_messages (task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_messages_lead_created ON channel_messages (lead_id, created_at);
