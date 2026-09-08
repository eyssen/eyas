// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Lifecycle of an EYAS-owned OpenCode / PTY session. */
export type OpencodeSessionState =
  | 'starting'
  | 'ready'
  | 'running'
  | 'idle'
  | 'exited'
  | 'error'

/** What the PTY actually runs. */
export type PtyKind = 'tui' | 'shell'

export interface OpencodeCheck {
  id: string
  label: string
  status: 'ok' | 'missing' | 'warn'
  detail?: string
  remedy?: string
}

export interface OpencodeDoctorStatus {
  available: boolean
  enabled: boolean
  checks: OpencodeCheck[]
  server: {
    running: boolean
    url: string | null
    version: string | null
  }
  pty: {
    available: boolean
    platform: string
  }
}

export interface OpencodeSettings {
  enabled: boolean
  cliPath: string | null
  /** Attach to an already-running OpenCode server instead of spawning one. */
  attachUrl: string | null
  /** Isolate config under data/opencode (recommended). When false, inherit the user ~/.config/opencode. */
  isolatedConfig: boolean
  maxPtySessions: number
  defaultCols: number
  defaultRows: number
}

export interface MemoryHit {
  id: string
  source: string
  content: string
  score: number
}

export interface MemoryQueryInput {
  query: string
  limit?: number
  conversationId?: string | null
  projectId?: string | null
}

export interface MemorySaveInput {
  content: string
  conversationId: string
  projectId?: string | null
  kind?: 'stdout' | 'diff' | 'reasoning' | 'note'
  meta?: Record<string, unknown>
}

export interface DeveloperTaskInput {
  prompt: string
  conversationId: string
  userId: string
  projectId?: string | null
  cwd?: string
  workingDirectories?: string[]
  model?: { providerID: string; modelID: string }
  timeoutMs?: number
}

export interface DeveloperTaskResult {
  ok: boolean
  sessionId: string | null
  summary: string
  diffs: FileDiff[]
  error?: string
}

export interface FileDiff {
  path: string
  additions: number
  deletions: number
  patch?: string
}

export interface OpencodeSessionInfo {
  id: string
  title: string
  directory?: string
}

/** Client → server PTY frames. */
export type TerminalClientFrame =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }

/** Server → client PTY frames. */
export type TerminalServerFrame =
  | { type: 'ready'; sessionId: string; pid: number; cols: number; rows: number }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number; signal?: number }
  | { type: 'error'; message: string }
  | { type: 'pong' }

export interface PtySessionRecord {
  id: string
  userId: string
  conversationId: string
  kind: PtyKind
  cwd: string
  cols: number
  rows: number
  pid: number
  state: OpencodeSessionState
  createdAt: number
  lastActivityAt: number
}

export interface CreatePtySessionInput {
  userId: string
  conversationId: string
  kind: PtyKind
  cwd?: string
  workingDirectories?: string[]
  cols?: number
  rows?: number
  env?: Record<string, string>
}

export interface PtyHandle {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: NodeJS.Signals): void
  onData(cb: (chunk: Uint8Array) => void): void
  onExit(cb: (info: { exitCode: number; signal?: number }) => void): void
  dispose(): void
}

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

export type PtyFactory = (opts: PtySpawnOptions) => PtyHandle

export interface OpencodeHttpSession {
  id: string
  title?: string
  directory?: string
}

export interface OpencodePromptPart {
  type: 'text'
  text: string
}

export interface OpencodeEvent {
  type: string
  properties?: Record<string, unknown>
}
