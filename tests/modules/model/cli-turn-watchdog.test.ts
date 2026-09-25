// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// G8 — the CLI turn watchdog: a CLI turn is bounded by silence, not by a wall
// clock. idleMs applies while no tool is in flight, toolMs while one is;
// every sign of life starts the clock over; a timeout aborts with a
// TimeoutError that the error taxonomy reads as 'timeout', never 'aborted'.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classifyModelError } from '@shared/classify-model-error.js'
import {
  createTurnWatchdog,
  cliTurnTimeoutsFrom,
  resolveCliTurnTimeouts,
  DEFAULT_CLI_IDLE_TIMEOUT_MS,
  DEFAULT_CLI_TOOL_TIMEOUT_MS,
} from '@modules/model/cli-turn-watchdog.js'

const MIN = 60_000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function watchdog(opts: { idleMs?: number; toolMs?: number } = {}) {
  const abort = vi.fn<(reason: DOMException) => void>()
  const dog = createTurnWatchdog({ idleMs: 10 * MIN, toolMs: 20 * MIN, label: 'Test CLI', ...opts, abort })
  return { dog, abort }
}

describe('createTurnWatchdog', () => {
  it('does not abort at 14 minutes while a tool is in flight with a 20-minute tool budget', () => {
    const { dog, abort } = watchdog()
    dog.toolStarted('call-1')
    vi.advanceTimersByTime(14 * MIN)
    expect(abort).not.toHaveBeenCalled()
    expect(dog.timedOut).toBe(false)
    dog.dispose()
  })

  it('aborts after idleMs with no activity', () => {
    const { dog, abort } = watchdog()
    vi.advanceTimersByTime(10 * MIN - 1)
    expect(abort).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(dog.timedOut).toBe(true)
    const reason = abort.mock.calls[0][0]
    expect(reason).toBeInstanceOf(DOMException)
    expect(reason.name).toBe('TimeoutError')
    expect(reason.message).toBe('Test CLI turn timed out: no activity for 600s')
  })

  it('touch() starts the silence clock over', () => {
    const { dog, abort } = watchdog()
    vi.advanceTimersByTime(9 * MIN)
    dog.touch()
    vi.advanceTimersByTime(9 * MIN)
    expect(abort).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1 * MIN)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it("the abort reason classifies as 'timeout', not 'aborted'", () => {
    const { dog, abort } = watchdog()
    vi.advanceTimersByTime(10 * MIN)
    const reason = abort.mock.calls[0][0]
    expect(classifyModelError(reason)).toMatchObject({ kind: 'timeout', retryable: true })
    // What the aborted SDK/CLI throws on its way out is replaced by the timeout.
    const sdkAbort = new Error('Claude Code process aborted by user')
    expect(classifyModelError(sdkAbort).kind).toBe('aborted')
    expect(dog.errorFor(sdkAbort)).toBe(reason)
  })

  it('errorFor() passes an error through unchanged while the watchdog has not fired', () => {
    const { dog } = watchdog()
    const err = new Error('boom')
    expect(dog.errorFor(err)).toBe(err)
    dog.dispose()
  })

  it('a tool silent past toolMs is stopped, and the reason says a tool was running', () => {
    const { dog, abort } = watchdog({ toolMs: 5 * MIN })
    dog.toolStarted('call-1')
    vi.advanceTimersByTime(5 * MIN)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(abort.mock.calls[0][0].message).toBe('Test CLI turn timed out: no activity for 300s while a tool was running')
  })

  it('the idle budget applies again once every tool settled', () => {
    const { dog, abort } = watchdog({ idleMs: 1 * MIN, toolMs: 5 * MIN })
    dog.toolStarted('a')
    dog.toolStarted('b')
    vi.advanceTimersByTime(3 * MIN)
    dog.toolFinished('a')
    // 'b' is still running: the tool budget holds.
    vi.advanceTimersByTime(3 * MIN)
    expect(abort).not.toHaveBeenCalled()
    dog.toolFinished('b')
    vi.advanceTimersByTime(1 * MIN)
    expect(abort).toHaveBeenCalledTimes(1)
    expect(abort.mock.calls[0][0].message).toMatch(/no activity for 60s$/)
  })

  it('observe() maps normalized events: tool_use_start opens, tool_result settles, anything else touches', () => {
    const { dog, abort } = watchdog({ idleMs: 1 * MIN, toolMs: 5 * MIN })
    dog.observe({ type: 'tool_use_start', id: 't1', name: 'run_specialist' })
    // A row upsert re-announces the same call: still one call in flight.
    dog.observe({ type: 'tool_use_start', id: 't1', name: 'run_specialist', input: { task: 'x' } })
    vi.advanceTimersByTime(4 * MIN)
    expect(abort).not.toHaveBeenCalled()
    dog.observe({ type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, durationMs: 1 })
    vi.advanceTimersByTime(59_000)
    dog.observe({ type: 'text', text: 'still here' })
    vi.advanceTimersByTime(59_000)
    expect(abort).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('dispose() stops it for good: no abort afterwards, and touch() does not re-arm it', () => {
    const { dog, abort } = watchdog()
    dog.dispose()
    dog.touch()
    dog.toolStarted('x')
    vi.advanceTimersByTime(60 * MIN)
    expect(abort).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fires once: activity after the timeout neither re-arms it nor aborts again', () => {
    const { dog, abort } = watchdog({ idleMs: 1 * MIN })
    vi.advanceTimersByTime(1 * MIN)
    dog.touch()
    vi.advanceTimersByTime(10 * MIN)
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('a failing abort callback never masks the timeout', () => {
    const dog = createTurnWatchdog({ idleMs: 1_000, abort: () => { throw new Error('already closed') } })
    vi.advanceTimersByTime(1_000)
    expect(dog.timedOut).toBe(true)
    expect(classifyModelError(dog.errorFor(new Error('x'))).kind).toBe('timeout')
  })

  it('invalid budgets fall back to the defaults instead of aborting at once', () => {
    const abort = vi.fn()
    const dog = createTurnWatchdog({ idleMs: 0, toolMs: Number.NaN, abort })
    vi.advanceTimersByTime(DEFAULT_CLI_IDLE_TIMEOUT_MS - 1)
    expect(abort).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(abort).toHaveBeenCalledTimes(1)
  })
})

describe('turn timeouts from config', () => {
  it('reads model.cli, else the defaults', () => {
    expect(cliTurnTimeoutsFrom({ model: { cli: { idleTimeoutMs: 1_000, toolTimeoutMs: 2_000 } } })).toEqual({ idleMs: 1_000, toolMs: 2_000 })
    expect(cliTurnTimeoutsFrom({})).toEqual({ idleMs: DEFAULT_CLI_IDLE_TIMEOUT_MS, toolMs: DEFAULT_CLI_TOOL_TIMEOUT_MS })
    expect(cliTurnTimeoutsFrom(undefined)).toEqual({ idleMs: 600_000, toolMs: 1_200_000 })
  })

  it('never yields a zero, negative or non-integer timeout', () => {
    expect(cliTurnTimeoutsFrom({ model: { cli: { idleTimeoutMs: 0, toolTimeoutMs: -1 } } })).toEqual({ idleMs: 600_000, toolMs: 1_200_000 })
    expect(cliTurnTimeoutsFrom({ model: { cli: { idleTimeoutMs: '60000', toolTimeoutMs: 1.5 } } })).toEqual({ idleMs: 600_000, toolMs: 1_200_000 })
  })

  it('resolveCliTurnTimeouts: a missing or throwing source means the defaults', () => {
    expect(resolveCliTurnTimeouts(undefined)).toEqual({ idleMs: 600_000, toolMs: 1_200_000 })
    expect(resolveCliTurnTimeouts(() => { throw new Error('no config') })).toEqual({ idleMs: 600_000, toolMs: 1_200_000 })
    expect(resolveCliTurnTimeouts(() => ({ idleMs: 5_000 }))).toEqual({ idleMs: 5_000, toolMs: 1_200_000 })
  })
})
