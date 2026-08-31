// Pure view logic for the AI-run panel. Kept out of the component so it can be
// tested, and imported relatively so it can be tested from the root runner —
// `@shared` resolves to a different directory there than it does in the web
// build.
import type { DesignAiRun } from './types'

/**
 * How far ahead of this browser the server's clock is, in milliseconds.
 *
 * An AI edit can run for nine minutes, and "started at" comes from the server
 * while "now" comes from the browser. Subtracting one from the other without
 * this correction shows whatever the two machines disagree about — which on a
 * laptop that has been asleep is not a small number.
 */
export function clockOffset(serverNow: number, clientNow: number): number {
  return serverNow - clientNow
}

/** This browser's clock, expressed on the server's. */
export function serverNowAt(clientNow: number, offset: number): number {
  return clientNow + offset
}

/**
 * How long the run has been going, or how long it took. A finished run is
 * measured against its own end, so its duration stops growing.
 */
export function runElapsedMs(run: DesignAiRun, serverNow: number): number {
  const end = run.finishedAt ?? serverNow
  return Math.max(0, end - run.startedAt)
}

/** `m:ss`, or `h:mm:ss` once it passes an hour. */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`
}

export type RunNotice =
  | { kind: 'none' }
  | { kind: 'running'; run: DesignAiRun }
  | { kind: 'ok'; run: DesignAiRun }
  | { kind: 'failed'; run: DesignAiRun }
  | { kind: 'interrupted'; run: DesignAiRun }

/**
 * What the panel reports, from the newest run only. The list arrives newest
 * first and is not re-sorted here: showing a friendlier older run would be a
 * lie about the current state of the canvas.
 */
export function runNotice(runs: DesignAiRun[]): RunNotice {
  const newest = runs[0]
  if (!newest) return { kind: 'none' }
  return { kind: newest.status, run: newest }
}
