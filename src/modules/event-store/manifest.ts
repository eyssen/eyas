// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule } from '@core/types'

/**
 * Event-Store module manifest.
 *
 * Pure infrastructure module — no UI pages, no optional deps. It exposes
 * event-sourcing primitives (append-only log, replay, snapshots) for any
 * other module that wants durable, replayable agent state.
 */
export const eventStoreManifest: Pick<
  EyasModule,
  'id' | 'name' | 'version' | 'type' | 'required' | 'description' | 'dependencies' | 'optional' | 'capabilities'
> = {
  id: 'event-store',
  name: 'Event Store',
  version: '0.1.0',
  type: 'core',
  required: false,
  description:
    'Append-only agent event log with replay engine and periodic snapshots. Inspired by OpenHands V1 SDK.',
  dependencies: [],
  optional: [],
  capabilities: ['event-sourcing', 'replay', 'snapshots'],
}
