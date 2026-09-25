// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasBus } from '@core/types'
import type { Logger } from 'pino'
import { Counter, Gauge, Registry } from '../registry.js'

export interface RuntimeMetrics {
  cpuSecondsTotal: Counter
  residentMemoryBytes: Gauge
  processStartTimeSeconds: Gauge
  eventLoopLagSeconds: Gauge
  schedulerLeader: Gauge
  collect(): void
  stop(): void
}

export interface RuntimeMetricsOptions {
  /** How often the runtime probe runs, in milliseconds. Defaults to 10s. */
  intervalMs?: number
  /** Override the process handle (useful for tests). */
  processRef?: NodeJS.Process
}

/**
 * Register process/runtime gauges + counters. Samples are refreshed on a
 * timer as well as on demand (via `collect()`), so /metrics always reports
 * up-to-date values at scrape time.
 *
 * Subscribed bus subjects:
 *  - `scheduler.leader.changed`   { instanceId, isLeader }
 */
export function registerRuntimeMetrics(
  registry: Registry,
  bus: EyasBus,
  logger: Logger,
  opts: RuntimeMetricsOptions = {},
): RuntimeMetrics {
  const proc = opts.processRef ?? (globalThis.process as NodeJS.Process)
  const intervalMs = opts.intervalMs ?? 10_000

  const cpuSecondsTotal = registry.register(
    new Counter({
      name: 'eyas_process_cpu_seconds_total',
      help: 'Total CPU time consumed by the process, in seconds.',
    }),
  )
  const residentMemoryBytes = registry.register(
    new Gauge({
      name: 'eyas_process_resident_memory_bytes',
      help: 'Resident set size of the process, in bytes.',
    }),
  )
  const processStartTimeSeconds = registry.register(
    new Gauge({
      name: 'eyas_process_start_time_seconds',
      help: 'Start time of the process since UNIX epoch, in seconds.',
    }),
  )
  const eventLoopLagSeconds = registry.register(
    new Gauge({
      name: 'eyas_event_loop_lag_seconds',
      help: 'Event loop lag measured by setTimeout drift, in seconds.',
    }),
  )
  const schedulerLeader = registry.register(
    new Gauge({
      name: 'eyas_scheduler_leader',
      help: 'Whether this instance is the scheduler leader (1) or follower (0).',
      labelNames: ['instance_id'],
    }),
  )

  // Initial start time (seconds since epoch, fractional OK).
  const startTimeSec = Date.now() / 1000
  processStartTimeSeconds.set({}, startTimeSec)

  let lastCpuSeconds = 0
  if (typeof proc?.cpuUsage === 'function') {
    const { user, system } = proc.cpuUsage()
    lastCpuSeconds = (user + system) / 1_000_000
  }

  const collect = (): void => {
    // CPU (cumulative counter — compute delta).
    if (typeof proc?.cpuUsage === 'function') {
      const { user, system } = proc.cpuUsage()
      const totalSec = (user + system) / 1_000_000
      const delta = totalSec - lastCpuSeconds
      if (delta > 0) cpuSecondsTotal.inc({}, delta)
      lastCpuSeconds = totalSec
    }
    // Memory (rss).
    if (typeof proc?.memoryUsage === 'function') {
      const mu = proc.memoryUsage()
      residentMemoryBytes.set({}, mu.rss)
    }
  }

  // Event loop lag probe — setTimeout drift in seconds.
  let probeTimer: NodeJS.Timeout | null = null
  const scheduleProbe = (): void => {
    const started = Date.now()
    probeTimer = setTimeout(() => {
      const elapsedMs = Date.now() - started
      const lagSec = Math.max(0, (elapsedMs - intervalMs) / 1000)
      eventLoopLagSeconds.set({}, lagSec)
      collect()
      scheduleProbe()
    }, intervalMs)
    if (typeof probeTimer.unref === 'function') probeTimer.unref()
  }
  scheduleProbe()

  bus.on('scheduler.leader.changed', async (data) => {
    if (!data || typeof data !== 'object') return
    const d = data as { instanceId?: string; isLeader?: boolean }
    if (!d.instanceId) return
    schedulerLeader.set({ instance_id: d.instanceId }, d.isLeader ? 1 : 0)
  })

  const stop = (): void => {
    if (probeTimer) {
      clearTimeout(probeTimer)
      probeTimer = null
    }
  }

  logger.debug('Prometheus: runtime metrics registered')

  return {
    cpuSecondsTotal,
    residentMemoryBytes,
    processStartTimeSeconds,
    eventLoopLagSeconds,
    schedulerLeader,
    collect,
    stop,
  }
}
