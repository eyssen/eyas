// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Where OTHER tools keep their memory. EYAS reads and writes memory only
// through its own stores; a model working inside EYAS may neither read nor
// write these. The only sanctioned way in is the Data port importer, which is
// EYAS code and never a model tool call.
//
// Versioned data, not logic: path-policy.ts consumes it, data-port's adapter
// root hints are checked against it (tests/modules/data-port/
// foreign-stores-consistency.test.ts), and the MCP signature list below is
// for the memory-store MCP block. Update `verified` when an entry is
// re-checked against a real install; `unverified` marks a documented shape
// nobody has seen on disk yet.

/** Bumped whenever an entry is added, removed or re-verified. */
export const FOREIGN_STORES_VERSION = '2026-09-23'

export type ForeignStoreCategory =
  /** A coding assistant's own state: settings, sessions, memory. */
  | 'cli'
  /** A note app's configuration, including its vault registry. */
  | 'note-app'

export interface ForeignMemoryStore {
  id: string
  /** Product name for messages and the UI. Product-neutral wording elsewhere. */
  label: string
  /**
   * `~/…` (relative to the user's home) or `$VAR/…` (an environment variable
   * that must hold an absolute path to count).
   */
  path: string
  /** Where the store lives when `$VAR` is unset — always protected as well. */
  fallback?: string
  kind: 'dir' | 'file'
  category: ForeignStoreCategory
  /** Evidence for the entry. */
  source: string
  /** Date the entry was last checked. */
  verified: string
  unverified?: true
  /** Obsidian's vault registry, relative to the store (note-app entries). */
  registry?: string
}

export const FOREIGN_MEMORY_STORES: readonly ForeignMemoryStore[] = [
  { id: 'claude', label: 'Claude Code', path: '~/.claude', kind: 'dir', category: 'cli', source: 'data-port claude-code adapter; CLI fixture 2.1.280 host-writes', verified: '2026-09-22' },
  { id: 'claude-json', label: 'Claude Code', path: '~/.claude.json', kind: 'file', category: 'cli', source: 'user MCP servers and project state; CLI fixture 2.1.280 host-writes', verified: '2026-09-22' },
  { id: 'grok', label: 'Grok CLI', path: '~/.grok', kind: 'dir', category: 'cli', source: 'data-port grok-cli adapter; CLI fixture grok 1.0.40', verified: '2026-09-22' },
  { id: 'codex', label: 'Codex CLI', path: '~/.codex', kind: 'dir', category: 'cli', source: 'data-port codex adapter (memories_*.sqlite, sessions)', verified: '2026-09-22' },
  { id: 'gemini', label: 'Gemini CLI', path: '~/.gemini', kind: 'dir', category: 'cli', source: 'data-port gemini-cli adapter', verified: '2026-09-22' },
  { id: 'cursor', label: 'Cursor', path: '~/.cursor', kind: 'dir', category: 'cli', source: 'data-port cursor adapter', verified: '2026-09-22' },
  { id: 'codeium', label: 'Windsurf', path: '~/.codeium', kind: 'dir', category: 'cli', source: 'data-port windsurf adapter (~/.codeium/windsurf, ~/.codeium/memories)', verified: '2026-09-22' },
  { id: 'kimi', label: 'Kimi CLI', path: '~/.kimi', kind: 'dir', category: 'cli', source: 'CLI fixture kimi 1.52.0 source-facts (KIMI_SHARE_DIR default)', verified: '2026-09-22' },
  { id: 'agents', label: 'shared agent skills', path: '~/.agents', kind: 'dir', category: 'cli', source: 'CLI fixture kimi 1.52.0 source-facts (~/.agents/skills)', verified: '2026-09-22' },
  { id: 'agents-config', label: 'shared agent skills', path: '$XDG_CONFIG_HOME/agents', fallback: '~/.config/agents', kind: 'dir', category: 'cli', source: 'CLI fixture kimi 1.52.0 source-facts (~/.config/agents/skills)', verified: '2026-09-22' },
  { id: 'copilot', label: 'GitHub Copilot CLI', path: '~/.copilot', kind: 'dir', category: 'cli', source: 'documented CLI config dir', verified: '2026-09-22', unverified: true },
  { id: 'opencode-config', label: 'OpenCode', path: '$XDG_CONFIG_HOME/opencode', fallback: '~/.config/opencode', kind: 'dir', category: 'cli', source: 'OpenCode XDG config dir', verified: '2026-09-22' },
  { id: 'opencode-data', label: 'OpenCode', path: '$XDG_DATA_HOME/opencode', fallback: '~/.local/share/opencode', kind: 'dir', category: 'cli', source: 'CLI fixture opencode 1.18.29 auth-location ($XDG_DATA_HOME/opencode/auth.json)', verified: '2026-09-22' },
  { id: 'opencode-state', label: 'OpenCode', path: '$XDG_STATE_HOME/opencode', fallback: '~/.local/state/opencode', kind: 'dir', category: 'cli', source: 'OpenCode XDG state dir', verified: '2026-09-22' },
  { id: 'obsidian-macos', label: 'Obsidian', path: '~/Library/Application Support/obsidian', kind: 'dir', category: 'note-app', registry: 'obsidian.json', source: 'Obsidian app config (macOS)', verified: '2026-09-22' },
  { id: 'obsidian-linux', label: 'Obsidian', path: '$XDG_CONFIG_HOME/obsidian', fallback: '~/.config/obsidian', kind: 'dir', category: 'note-app', registry: 'obsidian.json', source: 'Obsidian app config (Linux)', verified: '2026-09-22' },
  { id: 'obsidian-flatpak', label: 'Obsidian', path: '~/.var/app/md.obsidian.Obsidian', kind: 'dir', category: 'note-app', registry: 'config/obsidian/obsidian.json', source: 'Obsidian flatpak sandbox (Linux)', verified: '2026-09-22' },
  { id: 'obsidian-snap', label: 'Obsidian', path: '~/snap/obsidian', kind: 'dir', category: 'note-app', registry: 'current/.config/obsidian/obsidian.json', source: 'Obsidian snap package (Linux)', verified: '2026-09-22', unverified: true },
  { id: 'obsidian-windows', label: 'Obsidian', path: '$APPDATA/obsidian', kind: 'dir', category: 'note-app', registry: 'obsidian.json', source: 'Obsidian app config (Windows)', verified: '2026-09-22', unverified: true },
]

/** Dot-folders whose `memory`/`memories` sub-folder is another tool's memory at any depth (a repo's too). */
export const TOOL_DOT_DIRS: readonly string[] = [
  '.claude', '.grok', '.codex', '.gemini', '.kimi', '.cursor', '.codeium', '.windsurf',
]

/** Folder names that hold memory under one of TOOL_DOT_DIRS. */
export const MEMORY_DIR_NAMES: readonly string[] = ['memory', 'memories']

/** A folder with this name is memory kept for an assistant, wherever it sits. */
export const AI_MEMORY_SEGMENT = 'ai-memory'

/** An Obsidian vault is the folder that holds this marker. */
export const OBSIDIAN_MARKER = '.obsidian'

export interface SegmentRule {
  id: 'ai-memory' | 'obsidian-config' | 'tool-memory'
  description: string
}

/** Rules matched on exact path segments, wherever the path lives. */
export const SEGMENT_RULES: readonly SegmentRule[] = [
  { id: 'ai-memory', description: `a folder named ${AI_MEMORY_SEGMENT}` },
  { id: 'obsidian-config', description: `a vault's ${OBSIDIAN_MARKER} settings folder` },
  { id: 'tool-memory', description: `a memory or memories folder under ${TOOL_DOT_DIRS.join(', ')}` },
]

export interface ForeignMemoryMcpSignature {
  id: string
  label: string
  /** Package or binary names, matched exactly (a version suffix is ignored). */
  names: readonly string[]
  verified: string
  unverified?: true
}

/**
 * MCP servers whose only function is a second memory store. Names only —
 * a server pointed at a protected folder is caught by the path policy.
 */
export const FOREIGN_MEMORY_MCP_SIGNATURES: readonly ForeignMemoryMcpSignature[] = [
  { id: 'mcp-memory', label: 'MCP reference memory server', names: ['@modelcontextprotocol/server-memory', 'mcp-server-memory'], verified: '2026-09-22' },
  { id: 'basic-memory', label: 'Basic Memory', names: ['basic-memory'], verified: '2026-09-22', unverified: true },
  { id: 'mem0', label: 'Mem0 / OpenMemory', names: ['mem0-mcp', '@mem0/mcp-server', 'openmemory'], verified: '2026-09-22', unverified: true },
  { id: 'obsidian-mcp', label: 'Obsidian MCP servers', names: ['mcp-obsidian', 'obsidian-mcp', 'obsidian-mcp-server'], verified: '2026-09-22', unverified: true },
  { id: 'mcpvault', label: 'MCPVault (Obsidian vault server)', names: ['@bitbonsai/mcpvault', 'mcpvault'], verified: '2026-09-23' },
]
