// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import type { EyasDb, EyasModule, ModuleContext } from '@core/types'
import { createWorkspaceWriter } from '@modules/prompt-wizard/workspace-writer.js'
import { createDataPortTables } from './schema.js'
import { createDataPortService, failureReason } from './service.js'
import { createDataPortRoutes } from './routes.js'
import { buildApplyDeps, type ApplyDepsHost } from './apply-deps.js'
import {
  buildRollbackDeps,
  PROJECT_TYPE_PREFIX,
  snapshotProjectTypePrompt,
  type RollbackDepsHost,
} from './rollback-deps.js'
import type { ApplyDeps } from './pipeline/apply.js'
import type { RollbackDeps } from './rollback.js'

export { OWN_SKILLS_CATEGORY } from './constants.js'

/**
 * The agent whose workspace an approved rules import lands in: the oldest
 * enabled primary agent, else an addressable one, else any enabled one.
 */
export function resolveDefaultAgentId(db: EyasDb): string | null {
  // Each query stands alone — an install predating the `addressable` column must
  // still fall through to the last one instead of failing the whole lookup.
  const pick = (query: Parameters<EyasDb['all']>[0]): string | null => {
    try {
      return (db.all(query) as Array<{ id: string }>)[0]?.id ?? null
    } catch {
      return null
    }
  }
  return (
    pick(
      sql`SELECT id FROM agent_definitions WHERE enabled = 1 AND tier = 'primary' ORDER BY created_at ASC LIMIT 1`,
    ) ??
    pick(
      sql`SELECT id FROM agent_definitions WHERE enabled = 1 AND addressable = 1 ORDER BY name ASC LIMIT 1`,
    ) ??
    pick(sql`SELECT id FROM agent_definitions WHERE enabled = 1 ORDER BY name ASC LIMIT 1`)
  )
}

/** Current body of a workspace file, or of a project type's prompt for a `project-type:<id>` file. */
export function readWorkspaceFile(
  db: EyasDb,
  dataDir: string,
  agentId: string,
  file: string,
): string | null {
  if (file.startsWith(PROJECT_TYPE_PREFIX)) {
    try {
      const rows = db.all(
        sql`SELECT prompt FROM project_types WHERE id = ${file.slice(PROJECT_TYPE_PREFIX.length)}`,
      ) as Array<{ prompt: string }>
      return rows[0]?.prompt ?? null
    } catch {
      return null
    }
  }
  const path = join(dataDir, 'agents', agentId, file)
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Writes an approved body back where it came from: a project type's prompt, or the agent workspace.
 *
 * A project-type write goes straight to the column and bypasses the workspace
 * writer, so it leaves NO `.history` snapshot — a rollback of that target must
 * strip the `<!-- eyas-import:<id> -->` markers rather than look for a history file.
 */
export async function writeWorkspaceTarget(
  db: EyasDb,
  writer: { write: (req: { agentId: string; file: string; body: string }) => Promise<void> },
  req: { agentId: string; file: string; body: string },
): Promise<void> {
  if (req.file.startsWith(PROJECT_TYPE_PREFIX)) {
    db.run(
      sql`UPDATE project_types SET prompt = ${req.body} WHERE id = ${req.file.slice(PROJECT_TYPE_PREFIX.length)}`,
    )
    return
  }
  await writer.write(req)
}


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

    // Built per job, and from a module of its own so the two idempotency queries
    // and the asset-path wall can be exercised against a real database.
    const applyDepsFactory = (): ApplyDeps =>
      buildApplyDeps({
        host: ctx as unknown as ApplyDepsHost,
        dataDir,
        createProposal: (input) => service.createProposal(input),
        readWorkspaceFile: (agentId, file) => readWorkspaceFile(ctx.db, dataDir, agentId, file),
        resolveDefaultAgentId: () => resolveDefaultAgentId(ctx.db),
      })

    const service = createDataPortService({
      db: ctx.db,
      modelCtx: {
        model: (ctx as any).model,
        logger: ctx.logger,
      },
      applyDepsFactory,
      // Proposal rows carry the workspace owner's display name. The lookup is
      // resolved per call: the agent registry may arrive after this module, and
      // an agent renamed since the import must show its current name.
      agentName: (id) => (ctx as any).agents?.registry?.get(id)?.name ?? null,
      dataDir,
      logger: ctx.logger,
    })
    ;(ctx as any).dataPort = service

    const workspaceWriter = createWorkspaceWriter({ dataDir })

    // What an undo is allowed to touch, built from whatever the server has
    // running. The wiring lives in a module of its own so the asset-directory
    // wall and the vault reader behind the edited-note guard can be tested.
    const rollbackDeps: RollbackDeps = buildRollbackDeps({
      host: ctx as unknown as RollbackDepsHost,
      dataDir,
      readWorkspaceFile: (agentId, file) => readWorkspaceFile(ctx.db, dataDir, agentId, file),
      writeWorkspaceFile: async (agentId, file, body) => {
        // The project-type prompt has no writer-made history (see
        // writeWorkspaceTarget), so keep the pre-rollback text here.
        if (file.startsWith(PROJECT_TYPE_PREFIX)) {
          const previous = readWorkspaceFile(ctx.db, dataDir, agentId, file)
          if (previous !== null) snapshotProjectTypePrompt(dataDir, file, previous, ctx.logger)
        }
        await writeWorkspaceTarget(ctx.db, workspaceWriter, { agentId, file, body })
      },
    })

    // A-52 — a scan the server was killed in the middle of is walking nothing,
    // and the wizard would poll that header for ever. It is closed with an
    // honest reason, keeping every row a COMMITTED batch reached; a scan is cheap to
    // re-run, so it is never resumed. Done BEFORE the job sweep, so a resumed
    // import never reads a scan header mid-transition.
    try {
      const closedScans = service.closeInterruptedScans()
      if (closedScans > 0) {
        ctx.logger.warn(
          { scans: closedScans },
          'Data Port: scans left mid-walk by a restart were closed — every row a committed batch reached is kept, so a partial scan is still browsable and a re-scan is not blocked',
        )
      }
    } catch (err) {
      ctx.logger.warn(
        { err: failureReason(err) },
        'Data Port: could not close interrupted scans',
      )
    }

    // An import the server was killed in the middle of is neither running nor
    // ever going to finish on its own. It goes back on the queue and carries on
    // from its last committed batch (P-8); an undo the restart interrupted has
    // its claim released so it can be retried.
    try {
      const { resumed, released } = service.resumeInterruptedJobs()
      if (resumed > 0 || released > 0) {
        ctx.logger.warn(
          { resumed, released },
          'Data Port: work left mid-flight by a restart was picked up — an unfinished import resumes from its last committed batch, an unfinished rollback can be retried',
        )
      }
    } catch (err) {
      ctx.logger.warn(
        { err: failureReason(err) },
        'Data Port: could not resume interrupted import jobs',
      )
    }

    // P-12 — a scan taken before R11 kept its candidates as one JSON blob. It
    // is read once here, into the table every other code path now reads from,
    // so an old scan the owner left open still opens.
    try {
      const { migrated, failed } = service.migrateLegacyScans()
      if (migrated > 0 || failed > 0) {
        ctx.logger.info(
          { migrated, failed },
          'Data Port: stored scans moved into the candidate table — a scan whose stored list could not be read is marked failed and must be re-scanned',
        )
      }
    } catch (err) {
      ctx.logger.warn({ err: failureReason(err) }, 'Data Port: could not migrate stored scans')
    }

    createDataPortRoutes(ctx.http, {
      service,
      workspaceWriter: {
        write: (req) => writeWorkspaceTarget(ctx.db, workspaceWriter, req),
      },
      // Approval re-reads the file through the same resolver the scan used, so a
      // second approval appends to the first one instead of overwriting it.
      workspaceReader: {
        read: (agentId, file) => readWorkspaceFile(ctx.db, dataDir, agentId, file),
      },
      rollbackDeps,
    })

    ctx.logger.info('Data Port module started')
  },

  async onStop() {},
}
