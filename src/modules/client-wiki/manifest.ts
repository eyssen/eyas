// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'

export const clientWikiManifest: Omit<EyasModule, 'onRegister' | 'onStart' | 'onStop'> & {
  onRegister(ctx: ModuleContext): Promise<void>
  onStart(ctx: ModuleContext): Promise<void>
  onStop(ctx: ModuleContext): Promise<void>
} = {
  id: 'client-wiki',
  name: 'Client Wiki',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Per-project living knowledge base. Auto-maintained from closed tickets and team-session decisions.',
  dependencies: [],
  optional: ['search', 'model', 'memory', 'conversations', 'chatter', 'board'],
  capabilities: ['client-wiki.read', 'client-wiki.write', 'client-wiki.auto-update'],

  async onRegister(_ctx: ModuleContext) {
    // Table creation + service wiring happens in index.ts onStart, following the pattern of other modules.
  },
  async onStart(_ctx: ModuleContext) {},
  async onStop(_ctx: ModuleContext) {},
}
