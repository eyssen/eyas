// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/index.ts
//
// The design module — multi-artboard design canvases in the Claude Design
// format, rendered by EYAS's own MIT runtime.
//
// Publishes:
//   ctx.designs         the service (CRUD, versioning, links, the validator gate)
//   ctx.designStore     the file tree
//   ctx.designAiRuns    one row per AI edit attempt, so a nine-minute edit
//                       survives a reload or a dropped connection
//   design_* tools      registered into the shared registry so they reach CLI
//                       providers through the MCP bridge
//
// Printing needs a browser, which a self-hosted install may legitimately not
// have. The print service is therefore always constructed and never checked at
// boot — it answers "unavailable" at call time and the UI disables its buttons.
// Nothing about module startup depends on a browser existing.

import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasModule, ModuleContext } from '@core/types'
import { resolveInstance } from '@core/instance.js'
import { createDesignTables } from './schema.js'
import { createDesignStore } from './design-store.js'
import { createDesignService } from './design-service.js'
import { createDesignAiRunService } from './design-ai-runs.js'
import { createDesignTools } from './design-tools.js'
import { DESIGN_EDITOR_PROMPT, DESIGN_PROMPT_ID, PRIOR_DESIGN_PROMPTS } from './design-prompt.js'
import { createPrintService } from './print-service.js'
import { closeSharedHeadlessBrowser, sharedHeadlessBrowser } from '@shared/headless-browser.js'

/**
 * Seed the design prompt once, and READ IT BACK AT CALL TIME so an owner edit
 * wins. INSERT OR IGNORE never refreshes, so a later change to the shipped
 * text only reaches installs whose row still matches a previously shipped
 * default — which is what PRIOR_DESIGN_PROMPTS is for.
 */
function seedDesignPrompt(ctx: ModuleContext): void {
  try {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS design_prompts (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    ctx.db.run(sql`INSERT OR IGNORE INTO design_prompts (id, body) VALUES (${DESIGN_PROMPT_ID}, ${DESIGN_EDITOR_PROMPT})`)

    // Refresh only rows that still hold a previously shipped default.
    for (const prior of PRIOR_DESIGN_PROMPTS) {
      ctx.db.run(sql`UPDATE design_prompts SET body = ${DESIGN_EDITOR_PROMPT}, updated_at = datetime('now')
        WHERE id = ${DESIGN_PROMPT_ID} AND body = ${prior}`)
    }
  } catch (err) {
    ctx.logger.warn({ err }, 'Design prompt seeding failed; the built-in default will be used')
  }
}

function readDesignPrompt(ctx: ModuleContext): string | undefined {
  try {
    const rows = ctx.db.all(sql`SELECT body FROM design_prompts WHERE id = ${DESIGN_PROMPT_ID}`) as any[]
    const body = rows[0]?.body
    return typeof body === 'string' && body.trim() ? body : undefined
  } catch {
    return undefined
  }
}

export const designModule: EyasModule = {
  id: 'design',
  name: 'Design',
  version: '1.0.0',
  type: 'core',
  description: 'Design canvases: multi-artboard layouts in the Claude Design format, edited by hand or by AI, versioned and referenceable from any conversation.',
  // 'auth' is a route-ordering dependency, not just a data one — Hono composes
  // in registration order. Same reasoning as home.
  dependencies: ['permissions', 'auth', 'tools'],

  async onRegister(ctx: ModuleContext) {
    createDesignTables(ctx.db)

    const dataDir = resolveInstance({ ensureDirs: false }).dataDir
    const store = createDesignStore(join(dataDir, 'designs'))
    const designs = createDesignService(ctx.db, store)
    const aiRuns = createDesignAiRunService(ctx.db)

    // Nothing else can tell an orphan from a live run: a live run only exists
    // inside a request this process is serving, and this process has just
    // started. Anything still marked `running` belongs to a process that died.
    try {
      const closed = aiRuns.reconcileInterrupted()
      if (closed > 0) ctx.logger.info({ closed }, 'Closed design AI runs left open by a previous process')
    } catch (err) {
      ctx.logger.warn({ err }, 'Could not reconcile interrupted design AI runs')
    }

    try {
      ctx.permissions.registerSubject('Design', {
        actions: ['read', 'create', 'update', 'delete', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['manage'],
          user: ['read', 'create', 'update', 'delete'],
          agent: ['read', 'create', 'update'],
          guest: ['read'],
        },
      })
    } catch {
      // Already registered — registerSubject throws on a duplicate and would kill boot.
    }

    ;(ctx as any).designs = designs
    ;(ctx as any).designStore = store
    ;(ctx as any).designAiRuns = aiRuns

    ctx.logger.info('Design module registered')
  },

  async onStart(ctx: ModuleContext) {
    seedDesignPrompt(ctx)

    const designs = (ctx as any).designs

    // Plain text completion — every provider can do it. The AI route answers
    // 503 when no provider is configured rather than half-editing a canvas.
    const complete = async ({ system, user }: { system: string; user: string }) => {
      const res = await ctx.model.complete({
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 8000,
        metadata: { origin: 'interactive' },
      } as any)
      const blocks = (res as any)?.content
      if (typeof blocks === 'string') return blocks
      if (!Array.isArray(blocks)) return ''
      return blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text ?? '').join('')
    }

    const print = createPrintService({ browser: sharedHeadlessBrowser(), logger: ctx.logger })

    const { createDesignRoutes } = await import('./routes.js')
    createDesignRoutes(ctx.http, {
      designs,
      runs: (ctx as any).designAiRuns,
      complete,
      print,
      designPrompt: () => readDesignPrompt(ctx),
      logger: ctx.logger,
    })

    const registry = (ctx as any).tools?.registry
    if (registry) {
      for (const tool of createDesignTools({ designs: () => (ctx as any).designs })) {
        try {
          if (!registry.has?.(tool.name)) registry.register(tool)
        } catch (err) {
          ctx.logger.warn({ err, tool: tool.name }, 'Design tool registration skipped')
        }
      }
    }

    ctx.logger.info('Design module started')
  },

  async onStop() {
    // The browser is process-wide. Closing it
    // here is correct because module teardown means the process is going away;
    // a lazy relaunch would happen on the next call in any case.
    await closeSharedHeadlessBrowser()
  },
}
