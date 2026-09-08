import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { hashPassword } from '@modules/auth/providers/local'
import { isBun } from '@shared/platform'

// Track the raw sqlite handle so tests that need loadExtension() can reach it.
const rawHandleStore = new WeakMap<object, any>()

function createDrizzleDb() {
  if (isBun) {
    const { Database } = require('bun:sqlite')
    const { drizzle } = require('drizzle-orm/bun-sqlite')
    // Best-effort: point Bun at a system sqlite with extension loading enabled
    // so tests can exercise sqlite-vec when the environment supports it.
    try {
      const { existsSync } = require('fs')
      const paths = process.platform === 'darwin'
        ? ['/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib', '/usr/local/opt/sqlite/lib/libsqlite3.dylib']
        : ['/usr/lib/x86_64-linux-gnu/libsqlite3.so.0', '/usr/lib/aarch64-linux-gnu/libsqlite3.so.0', '/usr/lib64/libsqlite3.so.0']
      for (const p of paths) {
        if (existsSync(p)) { Database.setCustomSQLite(p); break }
      }
    } catch { /* fall back to bundled */ }
    const sqlite = new Database(':memory:')
    sqlite.run('PRAGMA foreign_keys = ON')
    const drizzled = drizzle(sqlite)
    rawHandleStore.set(drizzled, sqlite)
    return drizzled
  } else {
    const BetterSqlite3 = require('better-sqlite3')
    const { drizzle } = require('drizzle-orm/better-sqlite3')
    const sqlite = new BetterSqlite3(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const drizzled = drizzle(sqlite)
    rawHandleStore.set(drizzled, sqlite)
    return drizzled
  }
}

/** Returns the raw bun:sqlite / better-sqlite3 handle behind a drizzle wrapper created via createMemoryDb/createTestDb. */
export function getRawFromDrizzle(drizzled: any): any {
  return rawHandleStore.get(drizzled)
}

/** Lightweight in-memory Drizzle DB — use in tests that don't need the full schema from createTestDb */
export function createMemoryDb() {
  return createDrizzleDb()
}

export function createTestDb(_label: string) {
  function open() {
    const db = createDrizzleDb()
    db.run(sql`CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, is_system INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`INSERT OR IGNORE INTO roles (id, name, description) VALUES ('owner', 'Owner', 'Root'), ('admin', 'Admin', 'Admin'), ('user', 'User', 'User'), ('agent', 'Agent', 'Agent'), ('guest', 'Guest', 'Guest')`)
    db.run(sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user', is_root_owner INTEGER NOT NULL DEFAULT 0, is_agent INTEGER NOT NULL DEFAULT 0, agent_definition_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, user_agent TEXT, ip_address TEXT, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL, last_used_at TEXT, expires_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS setup_steps (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', data TEXT, completed_at TEXT)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, encrypted TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL, module TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(name, scope))`)
    db.run(sql`CREATE TABLE IF NOT EXISTS provider_config (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, settings TEXT DEFAULT '{}', is_default INTEGER NOT NULL DEFAULT 0, default_model TEXT, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS model_config (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES provider_config(id), model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, context_window INTEGER, max_output_tokens INTEGER, supports_tools INTEGER DEFAULT 1, supports_images INTEGER DEFAULT 1, supports_streaming INTEGER DEFAULT 1, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, task_id TEXT, title TEXT, status TEXT NOT NULL DEFAULT 'idle', provider_id TEXT, model_id TEXT, user_id TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, project_id TEXT, stage_id TEXT, priority TEXT DEFAULT 'normal', pinned INTEGER DEFAULT 0, position REAL DEFAULT 0, due_date TEXT, prompt TEXT, assignees TEXT, tags TEXT, mode TEXT NOT NULL DEFAULT 'simple', agent_id TEXT, parent_conversation_id TEXT, goal_description TEXT, complexity TEXT, total_cost_usd REAL DEFAULT 0, team_session_id TEXT, voice_scope_override TEXT, sdk_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER, effort TEXT, orchestration TEXT, search_context TEXT, working_directories TEXT, god_mode INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_task_id ON conversations(task_id)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, provider TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, attachments TEXT DEFAULT '[]', created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', default_stages TEXT NOT NULL DEFAULT '["Backlog","In Progress","Done"]', default_priority TEXT NOT NULL DEFAULT 'normal', color TEXT, icon TEXT, default_agent_id TEXT, indexed_sources TEXT, working_directories TEXT, skills TEXT, permissions TEXT, source TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, type_id TEXT, prompt TEXT, indexed_sources TEXT, working_directories TEXT, skills TEXT, permissions TEXT, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, default_agent_id TEXT, source TEXT NOT NULL DEFAULT 'user', design_system_id TEXT, default_connection_id TEXT, ticket_connection_id TEXT, wiki_auto_tickets INTEGER NOT NULL DEFAULT 0, wiki_auto_decisions INTEGER NOT NULL DEFAULT 0, wiki_ticket_body TEXT NOT NULL DEFAULT 'title', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, color TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_closed INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, is_folded INTEGER NOT NULL DEFAULT 0, bot_listen INTEGER NOT NULL DEFAULT 0, auto_assignee_id TEXT, wip_limit INTEGER, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS tag_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', sort_order INTEGER DEFAULT 0, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
    db.run(sql`CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#8b949e', category_id TEXT REFERENCES tag_categories(id) ON DELETE SET NULL, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT DEFAULT (datetime('now')))`)
    db.run(sql`CREATE TABLE IF NOT EXISTS conversation_tags (conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (conversation_id, tag_id))`)
    db.run(sql`CREATE TABLE IF NOT EXISTS activity_types (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, category TEXT NOT NULL DEFAULT 'default' CHECK (category IN ('default', 'upload_file', 'phonecall', 'meeting')), decoration TEXT NOT NULL DEFAULT 'normal' CHECK (decoration IN ('normal', 'warning', 'danger')), delay_days INTEGER DEFAULT 0, delay_unit TEXT DEFAULT 'days' CHECK (delay_unit IN ('days', 'weeks', 'months')), trigger_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, suggest_next_type_id TEXT REFERENCES activity_types(id) ON DELETE SET NULL, default_user_id TEXT, summary_template TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
    db.run(sql`CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES activity_types(id) ON DELETE CASCADE, res_model TEXT NOT NULL, res_id TEXT NOT NULL, summary TEXT, note TEXT, user_id TEXT NOT NULL, created_by_id TEXT NOT NULL, date_deadline TEXT NOT NULL, done_at TEXT, feedback TEXT, automated INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`)
    db.run(sql`CREATE TABLE IF NOT EXISTS chatter_messages (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, author_id TEXT, message_type TEXT NOT NULL DEFAULT 'comment' CHECK (message_type IN ('comment', 'note', 'tracking')), body TEXT NOT NULL, parent_id TEXT REFERENCES chatter_messages(id) ON DELETE SET NULL, created_at TEXT DEFAULT (datetime('now')))`)
    db.run(sql`CREATE INDEX IF NOT EXISTS idx_chatter_record ON chatter_messages(res_model, res_id, created_at)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS chatter_tracking (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL REFERENCES chatter_messages(id) ON DELETE CASCADE, field TEXT NOT NULL, old_value TEXT, new_value TEXT)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS chatter_followers (id TEXT PRIMARY KEY, res_model TEXT NOT NULL, res_id TEXT NOT NULL, user_id TEXT NOT NULL, subtypes TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now')), UNIQUE(res_model, res_id, user_id))`)
    // Agent tables
    db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, description TEXT, goal TEXT, backstory TEXT, tier TEXT NOT NULL DEFAULT 'specialist', agent_type TEXT NOT NULL DEFAULT 'assistant', system_prompt TEXT, capabilities TEXT, tools TEXT, constraints TEXT, model TEXT, max_turns INTEGER, effort TEXT, enabled INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'seed', avatar TEXT, tags TEXT, monthly_token_budget INTEGER DEFAULT 0, tokens_used_month INTEGER DEFAULT 0, budget_reset_at TEXT, config TEXT, addressable INTEGER NOT NULL DEFAULT 0, workspace_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS agent_sessions (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', turns_used INTEGER DEFAULT 0, tokens_used INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, tool_calls TEXT, error TEXT, started_at TEXT NOT NULL, completed_at TEXT)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS agent_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, from_agent TEXT NOT NULL, to_agent TEXT, content TEXT NOT NULL, created_at TEXT NOT NULL)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS team_sessions (id TEXT PRIMARY KEY, parent_conversation_id TEXT NOT NULL, goal_description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'proposing', config TEXT NOT NULL DEFAULT '{}', reasoning TEXT, estimated_tokens INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0, total_cost_usd REAL DEFAULT 0, originating_agent_id TEXT, parent_snapshot TEXT, created_at TEXT NOT NULL, completed_at TEXT)`)
    db.run(sql`CREATE TABLE IF NOT EXISTS team_memory (id TEXT PRIMARY KEY, team_session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT 'null', layer TEXT NOT NULL DEFAULT 'system', category TEXT NOT NULL DEFAULT 'fact', author_agent_id TEXT, visibility TEXT NOT NULL DEFAULT 'all', created_at TEXT NOT NULL)`)
    // Communication / channel tables
    db.run(sql`CREATE TABLE IF NOT EXISTS channel_configs (id TEXT PRIMARY KEY, channel_type TEXT NOT NULL, channel_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, agent_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, config TEXT DEFAULT '{}', force_voice_scope TEXT, mode TEXT NOT NULL DEFAULT 'managed', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    db.run(sql`CREATE TABLE IF NOT EXISTS internal_contacts (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, channel_type TEXT NOT NULL, display_name TEXT NOT NULL, role TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'internal', notes TEXT, added_at TEXT NOT NULL, added_by TEXT NOT NULL)`)
    db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS internal_contacts_ident_channel ON internal_contacts(identifier, channel_type)`)
    return db
  }

  function cleanup() {
    // In-memory DB — nothing to clean up on disk
  }

  return { open, cleanup, dbPath: ':memory:' }
}

export async function insertTestOwner(db: any, username = 'testowner', password = 'testpassword123'): Promise<string> {
  const id = generateId()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(password)
  db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
    VALUES (${id}, ${username}, ${username}, ${passwordHash}, 'owner', 1, 0, 'active', ${now}, ${now})`)
  return id
}
