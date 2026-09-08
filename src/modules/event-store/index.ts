// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createEventStoreTables } from './schema.js'
import { createEventStore, type EventStore } from './event-store.js'
import { createReplayEngine, type ReplayEngine } from './replay-engine.js'
import {
  createSnapshotManager,
  type SnapshotManager,
  type SnapshotManagerOptions,
} from './snapshot-manager.js'
import { eventStoreManifest } from './manifest.js'

export interface EventStoreServices {
  events: EventStore
  replay: ReplayEngine
  snapshots: SnapshotManager
}

/**
 * Factory — build all event-store services from a db handle.
 *
 * Exposed separately from the EyasModule lifecycle so tests and ad-hoc
 * callers can instantiate without a full ModuleContext.
 */
export function createEventStoreServices(
  db: import('@core/types').EyasDb,
  opts: SnapshotManagerOptions = {},
): EventStoreServices {
  const events = createEventStore(db)
  const snapshots = createSnapshotManager(db, events, opts)
  const replay = createReplayEngine(events, snapshots)
  return { events, replay, snapshots }
}

export const eventStoreModule: EyasModule = {
  ...eventStoreManifest,

  async onRegister(ctx: ModuleContext) {
    createEventStoreTables(ctx.db)

    // CASL subject: event log is read-only for most roles. Only owner/admin
    // may purge — there is no legitimate use case for a regular user or agent
    // to delete audit-like event history.
    try {
      ctx.permissions.registerSubject('AgentEvent', {
        actions: ['read', 'replay', 'snapshot', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'replay'],
          agent: ['read'],
          guest: [],
        },
      })
    } catch {
      // Already registered — safe to ignore.
    }

    ctx.logger.info('event-store: tables created')
  },

  async onStart(ctx: ModuleContext) {
    const services = createEventStoreServices(ctx.db)
    // Expose on the context for siblings without touching the core types.
    ;(ctx as any).eventStore = services

    const { createEventStoreRoutes } = await import('./routes.js')
    createEventStoreRoutes(ctx.http, services.events, services.replay, services.snapshots, ctx.logger)

    ctx.logger.info('event-store: module started')
  },

  async onStop() {
    // Nothing to clean up — DB is owned by the core.
  },
}

export * from './types.js'
export { createEventStore } from './event-store.js'
export type { EventStore } from './event-store.js'
export { createReplayEngine, applyEvent, initialAgentState } from './replay-engine.js'
export type { ReplayEngine, ReplayOptions } from './replay-engine.js'
export { createSnapshotManager } from './snapshot-manager.js'
export type { SnapshotManager, SnapshotManagerOptions } from './snapshot-manager.js'
export { createEventStoreTables } from './schema.js'
