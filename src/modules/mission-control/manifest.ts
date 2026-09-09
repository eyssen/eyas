// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule } from '@core/types'

/**
 * Mission Control manifest.
 *
 * Surfaces a live dashboard (grid view) of all running agent sessions
 * across teams and solo runs. Depends on event-store for latest events
 * and on the agent module (via dependency injection) for the in-memory
 * session registry.
 */
export const missionControlManifest: Pick<
  EyasModule,
  | 'id'
  | 'name'
  | 'version'
  | 'type'
  | 'required'
  | 'description'
  | 'dependencies'
  | 'optional'
  | 'capabilities'
  | 'frontend'
> = {
  id: 'mission-control',
  name: 'Mission Control',
  version: '0.1.0',
  type: 'core',
  required: false,
  description:
    'Live dashboard (Cursor 2.0-style grid) of running agent sessions — progress, token usage, cost, interrupt/pause/resume.',
  dependencies: ['event-store', 'permissions'],
  optional: ['agent'],
  capabilities: ['live-dashboard', 'agent-monitoring', 'agent-interrupt'],
  frontend: {
    pages: [
      {
        id: 'mission-control',
        path: '/mission-control',
        title: 'Mission Control',
        icon: 'activity',
        order: 15,
      },
    ],
    widgets: [{ id: 'mission-control.running', titleKey: 'home.widget.running.title' }],
  },
}
