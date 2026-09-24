// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// How the EYAS system prompt reaches an ACP CLI's model (Grok, Kimi), and for
// Grok the proof that it did (I8).
//
// Two channels:
//   - 'meta': session/new _meta.systemPromptOverride. grok 1.0.40 replaces
//     its own default system prompt with it (A1 spike: the model request's
//     system message was the override). ACP itself confirms nothing.
//   - 'prompt': the system prompt goes fenced into the first text block of
//     session/prompt. Every CLI honours it, but the CLI's own default system
//     prompt stays in place.
// Kimi always uses 'prompt': whether it honours the override is untested.
//
// Grok writes the system prompt it really uses to
// <GROK_HOME>/sessions/<encoded cwd>/<sessionId>/system_prompt.txt. Right
// after session/new that file still holds grok's DEFAULT prompt; the
// override shows up only once the first model request is built (A1 spike,
// tests/fixtures/cli/grok/1.0.40/system-prompt-file.json). A check before
// session/prompt would always fail, so the check runs after the turn, before
// the session store is purged, and it decides the channel of LATER turns:
//   - While the override is unproven for the grok binary, a turn sends both:
//     the override carrying a check marker, and the fenced copy. No turn
//     ever depends on an override nobody has seen work.
//   - The marker found in system_prompt.txt proves the binary: later turns
//     send the override alone, and each of them is checked the same way.
//   - The model answered but the marker is missing (the override was
//     ignored, or the file moved): EYAS logs a warning and every later turn
//     of this process uses 'prompt'.
// A turn that never reached the model (a failure, an abort) proves nothing
// either way. Verdicts are per binary (path, size, mtime) and per process, so
// a replaced grok is checked again. The marker is fixed for the provider
// instance, which keeps the system prompt identical from turn to turn.
//
// The live CLI lane (tests/live/cli-isolation.live.test.ts) proves the
// override channel on the real binary under the EYAS GROK_HOME: after a turn
// against a local fake model the marker is found and the turn reports
// 'meta-verified' (grok 1.0.41).

import { randomBytes } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { SystemPromptDelivery } from '../../types.js'

/**
 * Where the EYAS system prompt goes in an ACP turn.
 *   'meta'        — the session/new override only;
 *   'prompt'      — fenced, as the first text block of the prompt;
 *   'meta+prompt' — both, while Grok's override is unproven on its binary.
 */
export type AcpSystemPromptChannel = 'meta' | 'prompt' | 'meta+prompt'

/** What the runner reports once an ACP session is over (before its store is purged). */
export interface AcpSessionClosedInfo {
  /** The id session/new returned. */
  sessionId: string
  /** True when the model produced anything this turn (text, thought, plan, tool call). */
  modelAnswered: boolean
}

// ─── The prompt channel ─────────────────────────

const FENCE_TAG = 'eyas-system-prompt'

/**
 * The system prompt as the first text block of a turn. A closing tag inside
 * the text (recalled or owner-written content) is defused, so the frame
 * always ends where EYAS ended it.
 */
export function fenceSystemPrompt(system: string): string {
  const body = system.replace(new RegExp(`</(\\s*${FENCE_TAG})`, 'gi'), '<\\/$1')
  return [
    `<${FENCE_TAG}>`,
    'System instructions from EYAS, the application this conversation runs in. Follow them as your system prompt for this whole conversation.',
    '',
    body,
    `</${FENCE_TAG}>`,
  ].join('\n')
}

// ─── Grok's session record ─────────────────────

/** A session id that is safe as one path segment. */
const SessionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/)

/** Upper bound for the file EYAS reads back; a larger file is not read. */
const MAX_SYSTEM_PROMPT_BYTES = 4 * 1024 * 1024

const SYSTEM_PROMPT_FILE = 'system_prompt.txt'

/**
 * Locate <sessionStore>/<cwd group>/<sessionId>/system_prompt.txt. The cwd
 * group is URL-encoded, or a slug and hash for a long cwd (grok's session
 * docs), so it is found by scanning for the session id rather than by
 * encoding the cwd. Read-only; symlinks are never followed; an unsafe
 * session id is never joined into a path.
 */
export function findGrokSystemPromptFile(sessionStorePath: string, sessionId: string): string | null {
  if (!SessionIdSchema.safeParse(sessionId).success) return null
  let groups: import('node:fs').Dirent[]
  try {
    groups = readdirSync(sessionStorePath, { withFileTypes: true })
  } catch {
    return null
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue
    const sessionDir = join(sessionStorePath, group.name, sessionId)
    try {
      if (!lstatSync(sessionDir).isDirectory()) continue
      const file = join(sessionDir, SYSTEM_PROMPT_FILE)
      const st = lstatSync(file)
      if (st.isFile() && st.size <= MAX_SYSTEM_PROMPT_BYTES) return file
    } catch {
      /* not this group */
    }
  }
  return null
}

/** The system prompt grok recorded for a session, or null when there is none to read. */
export function readGrokSystemPrompt(sessionStorePath: string, sessionId: string): string | null {
  const file = findGrokSystemPromptFile(sessionStorePath, sessionId)
  if (!file) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

// ─── Grok channel choice ───────────────────────

type Verdict = 'meta' | 'prompt'

/** Per process: binary key → what its override proved to be. Absent: unproven. */
const verdicts = new Map<string, Verdict>()

/** Forget every verdict (tests). */
export function resetGrokSystemPromptVerdicts(): void {
  verdicts.clear()
}

/** A binary is its path plus what it is on disk: a replaced grok is a new binary. */
function binaryKey(executable: string): string {
  try {
    const st = statSync(executable)
    return `${executable}\0${st.mtimeMs}:${st.size}`
  } catch {
    return `${executable}\0-`
  }
}

/** The channel of one Grok turn. */
export interface GrokSystemPromptPlan {
  readonly channel: AcpSystemPromptChannel
  /** The line appended to the override ('meta' and 'meta+prompt'). */
  readonly marker?: string
  /** The binary the verdict is about. */
  readonly binary: string
}

export interface GrokSystemPromptChannel {
  /** The channel for the next turn, from the verdict of the binary that will run it. */
  plan(): Promise<GrokSystemPromptPlan>
  /**
   * Check the finished session and record the verdict. Returns how this
   * turn's system prompt reached the model. Call it from the runner's
   * onSessionClosed: once the session store is purged there is no record to
   * read. `closed` is null when no session was opened.
   */
  settle(plan: GrokSystemPromptPlan, closed: AcpSessionClosedInfo | null): SystemPromptDelivery
}

interface ChannelLogger {
  info?: (obj: unknown, msg?: string) => void
  warn?: (obj: unknown, msg?: string) => void
}

export interface GrokSystemPromptChannelOptions {
  /** The EYAS GROK_HOME's session store (profile.sessionStorePath). */
  sessionStorePath: string
  /** The executable the next turn will spawn (profile.resolveExecutable). */
  resolveExecutable: () => Promise<string>
  logger?: ChannelLogger
  /** Fixed marker nonce (tests); default: random per channel. */
  nonce?: string
}

export function createGrokSystemPromptChannel(opts: GrokSystemPromptChannelOptions): GrokSystemPromptChannel {
  const nonce = opts.nonce ?? randomBytes(8).toString('hex')
  const marker = `<!-- eyas-system-prompt-check ${nonce} -->`

  return {
    async plan() {
      let binary: string
      try {
        binary = binaryKey(await opts.resolveExecutable())
      } catch {
        // No binary: the run fails on its own; nothing to prove.
        return { channel: 'prompt', binary: '-' }
      }
      const verdict = verdicts.get(binary)
      if (verdict === 'prompt') return { channel: 'prompt', binary }
      return { channel: verdict === 'meta' ? 'meta' : 'meta+prompt', marker, binary }
    },

    settle(plan, closed) {
      if (plan.channel === 'prompt' || !plan.marker) return 'prompt'
      // Whatever the check says, the fenced copy of a 'meta+prompt' turn
      // reached the model; a 'meta' turn is unproven until the marker is seen.
      const unproven: SystemPromptDelivery = plan.channel === 'meta' ? 'meta-unverified' : 'prompt'
      if (!closed) return unproven

      const recorded = readGrokSystemPrompt(opts.sessionStorePath, closed.sessionId)
      if (recorded !== null && recorded.includes(plan.marker)) {
        if (verdicts.get(plan.binary) !== 'meta') {
          opts.logger?.info?.({ provider: 'grok-cli' }, 'grok-cli: the system prompt override is honoured — later turns send it alone')
        }
        verdicts.set(plan.binary, 'meta')
        return 'meta-verified'
      }
      // A turn that never reached the model proves nothing either way.
      if (!closed.modelAnswered) return unproven

      verdicts.set(plan.binary, 'prompt')
      opts.logger?.warn?.(
        { provider: 'grok-cli', channel: plan.channel, recordFound: recorded !== null },
        'grok-cli: the system prompt override did not reach the model — later turns send the EYAS system prompt inside the message',
      )
      return unproven
    },
  }
}
