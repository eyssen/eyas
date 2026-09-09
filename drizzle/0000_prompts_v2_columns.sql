-- Drizzle migration: prompts_v2_columns
-- Adds columns and tables for the v2 prompt architecture.
-- Idempotent where possible; safe to apply against an existing v1 EYAS database.

-- agent_definitions: add addressable + workspace_path
ALTER TABLE agent_definitions ADD COLUMN addressable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_definitions ADD COLUMN workspace_path TEXT;

-- team_sessions: add originating_agent_id + parent_snapshot
ALTER TABLE team_sessions ADD COLUMN originating_agent_id TEXT;
ALTER TABLE team_sessions ADD COLUMN parent_snapshot TEXT;

-- conversations: add voice_scope_override
ALTER TABLE conversations ADD COLUMN voice_scope_override TEXT;

-- channel_configs: add force_voice_scope
ALTER TABLE channel_configs ADD COLUMN force_voice_scope TEXT;

-- forge_proposals: add field column
-- Note: SQLite cannot ALTER a CHECK constraint in place. The check on the `target`
-- column is enforced at the service layer (forge module validates target enum at
-- proposal create time). For new DBs the CREATE TABLE definition includes the
-- updated values 'soul' | 'project_rule' | 'skill' | 'tool'.
ALTER TABLE forge_proposals ADD COLUMN field TEXT;

-- internal_contacts: new table
CREATE TABLE internal_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'internal',
  notes TEXT,
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL
);
CREATE UNIQUE INDEX internal_contacts_ident_channel ON internal_contacts (identifier, channel_type);
