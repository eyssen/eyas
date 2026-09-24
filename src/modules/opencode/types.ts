// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EffortLevel } from '@modules/model/reasoning/ladder.js'

/** Longest provider or model id EYAS stores or forwards (OpenCode ids such as `openrouter/vendor/model:tag`). */
export const OPENCODE_MODEL_ID_MAX = 200
/** Longest reasoning-variant name EYAS stores or forwards (OpenCode names such as `high` or `xhigh`). */
export const OPENCODE_VARIANT_MAX = 64
/** Provider, model and variant ids carry no control characters (they are shown in the UI and sent as JSON). */
export const OPENCODE_ID_PATTERN = /^[^\u0000-\u001f\u007f]+$/

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
  /** English label; the UI shows opencode.check.<id>.label when it has one. */
  label: string
  status: 'ok' | 'missing' | 'warn'
  /** English detail; the fallback for the localized text below. */
  detail?: string
  /** Localized detail: opencode.check.<id>.<detailId>, interpolated with detailVars. */
  detailId?: string
  detailVars?: Record<string, string>
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
  /**
   * Attach to an already-running OpenCode server instead of spawning one. An
   * external server keeps its own config, sign-in and permission rules: EYAS
   * cannot isolate it. A spawned server always runs in the EYAS-owned home.
   */
  attachUrl: string | null
  maxPtySessions: number
  defaultCols: number
  defaultRows: number
  /**
   * Model of the headless tasks (opencode_run), as OpenCode's own
   * /config/providers lists it. null: OpenCode's own default model.
   */
  model: OpencodeModelRef | null
  /**
   * Reasoning variant of `model` (a name from that model's `variants`).
   * null: the model's default. Always null without a model.
   */
  variant: string | null
}

/** An OpenCode model address (session.prompt `model`). */
export interface OpencodeModelRef {
  providerID: string
  modelID: string
}

/** One reasoning variant OpenCode offers for a model. */
export interface OpencodeVariantInfo {
  /** OpenCode's own name, sent back verbatim as the prompt's `variant`. */
  id: string
  /** The canonical effort rung when the name is one; null for a provider-specific name. */
  level: EffortLevel | null
}

export interface OpencodeModelInfo {
  id: string
  name: string
  /** Empty: the model has no reasoning variants. */
  variants: OpencodeVariantInfo[]
  /**
   * The tokens the model takes in, as OpenCode's own `limit` lists them: the
   * input limit when there is one, else the context window. It sizes the
   * memory a task sends to this model (developer-agent.ts). Absent: OpenCode
   * lists no usable limit for the model.
   */
  contextWindow?: number
}

export interface OpencodeProviderInfo {
  id: string
  name: string
  models: OpencodeModelInfo[]
}

/** The models the running OpenCode server can use (GET /config/providers), without credentials. */
export interface OpencodeModelCatalog {
  providers: OpencodeProviderInfo[]
  /** OpenCode's default model per provider id. */
  defaults: Record<string, string>
}

/** Which kind of OpenCode process a plugin key belongs to (plugin-tokens.ts). */
export type PluginTokenOwnerKind = 'serve' | 'pty'

/** What an OpenCode session acts for, recorded in-process when EYAS creates it (developer-agent.ts). */
export interface OpencodeSessionScope {
  /** The EYAS conversation of the opencode_run call: its project decides what memory the session reads. */
  conversationId: string
  userId: string
  /** The EYAS answer turn of that call: the session shares its memory drill budget. */
  turnId?: string
  runId?: string
  agentId?: string
  /** The OpenCode model the task was sent to (`provider/model`), for capture provenance. */
  model?: string | null
}

/**
 * The server-side record of one EYAS-created OpenCode session (memory-bridge.ts):
 * which plugin key its process holds and what it acts for. A plugin call
 * proves only its session id (plugin-tokens.ts); everything else comes from here.
 */
export interface OpencodeSessionBinding extends OpencodeSessionScope {
  tokenId: string
  sessionId: string
  /** callIDs of the tool parts already captured (a part is updated many times). */
  captured: Set<string>
}

/** Who is asking for a session's binding: an OpenCode plugin (the key its session proof was made with) or a signed-in user. */
export type OpencodeSessionCaller =
  | { kind: 'plugin'; tokenId: string }
  | { kind: 'user'; userId: string }

export interface DeveloperTaskInput {
  prompt: string
  conversationId: string
  userId: string
  /** Agent and supervised run of the opencode_run call (gate audit, approval rows). */
  agentId?: string
  runId?: string
  /** The EYAS answer turn of the opencode_run call (the session's memory drill budget). */
  turnId?: string
  cwd?: string
  workingDirectories?: string[]
  /** The settings model (opencode_run). Absent or null: OpenCode's own default. */
  model?: OpencodeModelRef | null
  /** The settings variant; forwarded only when `model` offers it. */
  variant?: string | null
  timeoutMs?: number
}

/** The model and variant a task actually ran with. model null: OpenCode's default (not reported back). */
export interface OpencodeEffectiveModel {
  model: OpencodeModelRef | null
  variant: string | null
}

export interface DeveloperTaskResult {
  ok: boolean
  sessionId: string | null
  summary: string
  diffs: FileDiff[]
  /** Set once the task has resolved what to send; read back from OpenCode's reply when it names them. */
  effective?: OpencodeEffectiveModel
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
  /**
   * An OpenCode TUI's memory-plugin key (plugin-tokens.ts): the factory
   * writes it into the child's fd 3 and ends it — never into its environment.
   */
  pluginKey?: string
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
