// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import type { Context } from 'hono'
import { missionControlManifest } from './manifest.js'
import {
  createAggregator,
  type Aggregator,
  type DailyStatsProvider,
} from './aggregator.js'
import {
  createMissionControlRoutes,
  type MissionControlAuthHooks,
} from './routes.js'
import type { AgentSessionRegistry } from './types.js'
import { WS_TOPICS } from '@shared/ws-topics.js'

export interface MissionControlServices {
  aggregator: Aggregator
  /** Stops the WS ping subscription (owned separately from the aggregator's own subs). */
  unsubscribePing: () => void
}

/**
 * Push a THIN ping whenever the aggregator has news; the client refetches
 * `/mission-control/snapshot`, which is where the per-owner filter lives.
 * The snapshot itself must never ride the socket — WS topic subscription is
 * authenticated but not permission-scoped, so a snapshot frame would leak
 * every user's runs to every subscriber.
 */
export function wireMissionControlPing(
  aggregator: Aggregator,
  broadcast: (topic: string, message: unknown) => void,
  now: () => number = () => Date.now(),
): () => void {
  return aggregator.subscribe(() => {
    broadcast(WS_TOPICS.missionControl, { event: 'mission-control', data: { ts: now() } })
  })
}

/**
 * The agent module is expected to expose a registry via the module
 * context during bootstrap. Until that's wired, this module falls back
 * to an empty registry so the dashboard still renders (just empty).
 */
function getAgentRegistry(ctx: ModuleContext): AgentSessionRegistry {
  const existing = (ctx as any).agentRegistry as AgentSessionRegistry | undefined
  if (existing) return existing
  return {
    list: () => [],
    get: () => undefined,
    interrupt: async () => {
      throw new Error('agent registry not available')
    },
    pause: async () => {
      throw new Error('agent registry not available')
    },
    resume: async () => {
      throw new Error('agent registry not available')
    },
  }
}

function getStats(ctx: ModuleContext): DailyStatsProvider {
  const existing = (ctx as any).agentDailyStats as DailyStatsProvider | undefined
  if (existing) return existing
  return {
    completedToday: () => 0,
    costTodayUsd: () => 0,
  }
}

function defaultAuthHooks(ctx: ModuleContext): MissionControlAuthHooks {
  const existing = (ctx as any).authHooks as MissionControlAuthHooks | undefined
  if (existing) return existing
  // Reads the keys the auth middleware actually sets: c.get('userId') and
  // c.get('role') (NOT 'user'). With the old 'user' key getUserId always
  // returned null, so these routes failed closed / were unreachable.
  return {
    getUserId(c: Context): string | null {
      return ((c as any).get?.('userId') as string | undefined) ?? null
    },
    isAdmin(c: Context): boolean {
      const role = (c as any).get?.('role') as string | undefined
      return role === 'admin' || role === 'owner'
    },
  }
}

export const missionControlModule: EyasModule = {
  ...missionControlManifest,

  async onRegister(ctx: ModuleContext) {
    ctx.permissions.registerSubject('AgentSession', {
      actions: ['read', 'interrupt', 'pause', 'resume'],
      defaults: {
        owner: ['read', 'interrupt', 'pause', 'resume'],
        admin: ['read', 'interrupt', 'pause', 'resume'],
        user: ['read'],
      },
    })
  },

  async onStart(ctx: ModuleContext) {
    const registry = getAgentRegistry(ctx)
    const stats = getStats(ctx)
    const auth = defaultAuthHooks(ctx)

    // event-store services are exposed on the context by that module.
    const eventStore = (ctx as any).eventStore as
      | { events: import('@modules/event-store/event-store').EventStore }
      | undefined
    if (!eventStore) {
      throw new Error('mission-control: event-store services missing on context')
    }

    const aggregator = createAggregator(registry, eventStore.events, ctx.bus, stats)

    const unsubscribePing = wireMissionControlPing(aggregator, (topic, message) => {
      ;(ctx as any).wsRegistry?.broadcast(topic, message)
    })

    const services: MissionControlServices = { aggregator, unsubscribePing }
    ;(ctx as any).missionControl = services

    createMissionControlRoutes(ctx.http, { aggregator, registry, auth, logger: ctx.logger })

    ctx.logger.info('mission-control: module started')
  },

  async onStop(ctx: ModuleContext) {
    const services = (ctx as any).missionControl as MissionControlServices | undefined
    services?.unsubscribePing()
    services?.aggregator.dispose()
  },
}

export * from './types.js'
export { createAggregator } from './aggregator.js'
export type { Aggregator, DailyStatsProvider } from './aggregator.js'
export { createMissionControlRoutes } from './routes.js'
export type {
  MissionControlAuthHooks,
  MissionControlRouteDeps,
} from './routes.js'
