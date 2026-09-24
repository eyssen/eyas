// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The CLI turn watchdog (G8). A CLI provider turn (Claude Code, Grok, Kimi)
// runs a whole agentic loop inside the CLI, so EYAS cannot bound it per model
// call as the API loop does. It bounds it by silence instead of by a wall
// clock:
//   - idleMs: the longest the CLI may say nothing while no tool is in flight;
//   - toolMs: the longest it may say nothing while at least one tool is in
//     flight — a bridged run_specialist or a long build legitimately runs for
//     many minutes without a word, and gets the same time it would get on an
//     API provider.
// Every SDK message or ACP update re-arms the deadline (touch). A timeout
// aborts the turn with a DOMException named 'TimeoutError', which the one
// error taxonomy (classify-model-error.ts) reads as 'timeout' — never as the
// 'aborted' of an operator's Stop. The operator Stop and the stuck-run sweep
// still apply on top.

import type { StreamEvent } from './types.js'

/** Default model.cli.idleTimeoutMs: 10 minutes of silence with no tool in flight. */
export const DEFAULT_CLI_IDLE_TIMEOUT_MS = 10 * 60_000
/** Default model.cli.toolTimeoutMs: 20 minutes of silence while a tool runs (above run_specialist's 15). */
export const DEFAULT_CLI_TOOL_TIMEOUT_MS = 20 * 60_000

/** How long a CLI turn may be silent (config model.cli). */
export interface CliTurnTimeouts {
  /** Silence allowed while no tool is in flight. */
  idleMs: number
  /** Silence allowed while at least one tool is in flight. */
  toolMs: number
}

/** A lazily read CliTurnTimeouts: each turn reads it once, at its start (reload-safe). */
export type CliTurnTimeoutsSource = () => Partial<CliTurnTimeouts> | undefined

const positiveInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined

/**
 * The turn timeouts of a config (ctx.config.model.cli), each falling back to
 * its default when unset or not a positive integer. Tolerant on purpose: a
 * test context or a partially built config never yields a zero or NaN
 * timeout, which would abort every turn at once.
 */
export function cliTurnTimeoutsFrom(config: unknown): CliTurnTimeouts {
  const cli = (config as { model?: { cli?: { idleTimeoutMs?: unknown; toolTimeoutMs?: unknown } } } | null | undefined)?.model?.cli
  return {
    idleMs: positiveInt(cli?.idleTimeoutMs) ?? DEFAULT_CLI_IDLE_TIMEOUT_MS,
    toolMs: positiveInt(cli?.toolTimeoutMs) ?? DEFAULT_CLI_TOOL_TIMEOUT_MS,
  }
}

/** Resolve a provider's timeouts source for one turn; a failing or absent source means the defaults. */
export function resolveCliTurnTimeouts(source: CliTurnTimeoutsSource | undefined): CliTurnTimeouts {
  let value: Partial<CliTurnTimeouts> | undefined
  try {
    value = source?.()
  } catch {
    value = undefined
  }
  return {
    idleMs: positiveInt(value?.idleMs) ?? DEFAULT_CLI_IDLE_TIMEOUT_MS,
    toolMs: positiveInt(value?.toolMs) ?? DEFAULT_CLI_TOOL_TIMEOUT_MS,
  }
}

export interface TurnWatchdogOptions extends Partial<CliTurnTimeouts> {
  /** Called once, when the turn timed out, with the TimeoutError that ends it. */
  abort: (reason: DOMException) => void
  /** Who timed out, for the error text ('Claude Code', 'Grok CLI'). */
  label?: string
}

export interface TurnWatchdog {
  /** The CLI said something: the silence clock starts over. */
  touch(): void
  /** A tool started: while any is in flight, the tool budget applies. Idempotent per id. */
  toolStarted(id: string): void
  /** A tool settled: once none is in flight, the idle budget applies again. */
  toolFinished(id: string): void
  /**
   * Feed one normalized stream event: tool_use_start → toolStarted,
   * tool_result → toolFinished, anything else → touch.
   */
  observe(event: StreamEvent): void
  /** The turn is over: the timer stops for good. */
  dispose(): void
  /** True once the watchdog aborted the turn. */
  readonly timedOut: boolean
  /**
   * The error a failed turn ends with: the watchdog's TimeoutError once it
   * fired (whatever the aborted CLI or SDK threw on its way out), else `err`.
   */
  errorFor<E>(err: E): E | DOMException
}

export function createTurnWatchdog(opts: TurnWatchdogOptions): TurnWatchdog {
  const idleMs = positiveInt(opts.idleMs) ?? DEFAULT_CLI_IDLE_TIMEOUT_MS
  const toolMs = positiveInt(opts.toolMs) ?? DEFAULT_CLI_TOOL_TIMEOUT_MS
  const label = opts.label?.trim() || 'CLI'
  const inFlight = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let reason: DOMException | undefined
  let disposed = false

  const fire = (toolRunning: boolean, ms: number): void => {
    timer = undefined
    if (disposed || reason) return
    const seconds = Math.round(ms / 1000)
    reason = new DOMException(
      toolRunning
        ? `${label} turn timed out: no activity for ${seconds}s while a tool was running`
        : `${label} turn timed out: no activity for ${seconds}s`,
      'TimeoutError',
    )
    try {
      opts.abort(reason)
    } catch {
      // A failing abort never masks the timeout: errorFor() still reports it.
    }
  }

  const arm = (): void => {
    if (disposed || reason) return
    if (timer !== undefined) clearTimeout(timer)
    const toolRunning = inFlight.size > 0
    const ms = toolRunning ? toolMs : idleMs
    timer = setTimeout(() => fire(toolRunning, ms), ms)
  }

  const watchdog: TurnWatchdog = {
    touch: arm,
    toolStarted(id) {
      if (id) inFlight.add(id)
      arm()
    },
    toolFinished(id) {
      inFlight.delete(id)
      arm()
    },
    observe(event) {
      if (event.type === 'tool_use_start') watchdog.toolStarted(event.id)
      else if (event.type === 'tool_result') watchdog.toolFinished(event.toolUseId)
      else arm()
    },
    dispose() {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      inFlight.clear()
    },
    get timedOut() {
      return reason !== undefined
    },
    errorFor(err) {
      return reason ?? err
    },
  }
  // The clock runs from the turn's start: a CLI that never says a word times out too.
  arm()
  return watchdog
}
