// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { createWorkspaceWriter } from '@modules/prompt-wizard/workspace-writer.js'
import { createDataPortTables } from './schema.js'
import { createDataPortService } from './service.js'
import { createDataPortRoutes } from './routes.js'
import type { ApplyDeps } from './pipeline/apply.js'

export { OWN_SKILLS_CATEGORY } from './constants.js'

export const dataPortModule: EyasModule = {
  id: 'data-port',
  name: 'Data Port',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Import wizard for memory/skills/rules from prior AI systems; export stub',
  dependencies: [],
  optional: ['memory', 'skills', 'model', 'agent', 'prompt-wizard'],

  async onRegister(ctx: ModuleContext) {
    createDataPortTables(ctx.db)

    try {
      ;(ctx as any).permissions?.registerSubject?.('DataPort', {
        actions: ['read', 'create', 'update', 'delete', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read'],
        },
      })
    } catch {
      /* permissions optional during early boot */
    }

    ctx.logger.info('Data Port module registered')
  },

  async onStart(ctx: ModuleContext) {
    const dataDir = (ctx.config as any)?.dataDir ?? 'data'

    const applyDepsFactory = (): ApplyDeps => {
      const memory = (ctx as any).memory
      const skills = (ctx as any).skills?.loader

      return {
        episodic: memory?.episodic,
        vault: memory?.vault,
        indexer: memory?.indexer,
        skills: skills
          ? {
              create: (input) => skills.create(input),
            }
          : undefined,
        createProposal: (input) => service.createProposal(input),
        readWorkspaceFile: (agentId, file) => {
          const root = join(dataDir, 'agents', agentId)
          const path = join(root, file)
          if (!existsSync(path)) return null
          try {
            return readFileSync(path, 'utf-8')
          } catch {
            return null
          }
        },
        resolveDefaultAgentId: () => {
          try {
            const rows = ctx.db.all(
              sql`SELECT id FROM agent_definitions WHERE enabled = 1 AND addressable = 1 ORDER BY name ASC LIMIT 1`,
            ) as Array<{ id: string }>
            if (rows[0]?.id) return rows[0].id
            const any = ctx.db.all(
              sql`SELECT id FROM agent_definitions WHERE enabled = 1 ORDER BY name ASC LIMIT 1`,
            ) as Array<{ id: string }>
            return any[0]?.id ?? null
          } catch {
            return null
          }
        },
        logger: ctx.logger,
      }
    }

    const service = createDataPortService({
      db: ctx.db,
      modelCtx: {
        model: (ctx as any).model,
        logger: ctx.logger,
      },
      applyDepsFactory,
      dataDir,
      logger: ctx.logger,
    })
    // re-bind createProposal after service exists — already closed over service above
    // applyDepsFactory references service; ensure service is assigned first.
    // Fix circular: recreate factory is fine since createProposal is on service.

    ;(ctx as any).dataPort = service

    const workspaceWriter = createWorkspaceWriter({ dataDir })
    createDataPortRoutes(ctx.http, {
      service,
      workspaceWriter: {
        write: async (req) => {
          await workspaceWriter.write({
            agentId: req.agentId,
            file: req.file,
            body: req.body,
          })
        },
      },
    })

    // Owner/admin already have manage via defaults; ensure admin role ability
    // also includes DataPort for environments that rebuild abilities from roles.ts
    try {
      const perms = (ctx as any).permissions
      if (perms?.registerSubject) {
        // already registered in onRegister
      }
    } catch { /* ignore */ }

    ctx.logger.info('Data Port module started')
  },

  async onStop() {},
}
