// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { hashPassword } from './providers/local.js'
import { createAuthRoutes } from './routes.js'
import { createTokenService } from './token.js'
import { createSecretsRoutes } from '@modules/secrets/routes'
import { createModelRoutes } from '@modules/model/routes'

export const authModule: EyasModule = {
  id: 'auth',
  name: 'Auth',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'Authentication — users, sessions, JWT tokens, API keys',
  dependencies: ['permissions', 'setup', 'secrets'],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        is_root_owner INTEGER NOT NULL DEFAULT 0,
        is_agent INTEGER NOT NULL DEFAULT 0,
        agent_definition_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL
      )
    `)
    ctx.db.run(sql`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        last_used_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      )
    `)
    try { ctx.db.run(sql`ALTER TABLE users ADD COLUMN agent_definition_id TEXT`) } catch { /* exists */ }

    // D14 — fresh-per-subscribe role lookup for the WS topic ACL (1 SELECT,
    // no caching: closes the stale-role gap a cached/JWT-carried role would
    // have across a live socket). A missing/suspended user denies EVERYTHING
    // in the ACL, including the global topics — so this returns undefined,
    // not just an empty role string, whenever the row is gone or inactive.
    ;(ctx as any).wsAcl?.setRoleLookup((userId: string): string | undefined => {
      const rows = ctx.db.all(sql`SELECT role, status FROM users WHERE id = ${userId}`) as { role: string; status: string }[]
      const row = rows[0]
      if (!row || row.status !== 'active') return undefined
      return row.role
    })

    ctx.setup.registerStep({
      id: 'root-owner',
      module: 'auth',
      title: 'Root Owner',
      description: 'Create the main administrator account',
      required: true,
      order: 10,
      fields: [
        { name: 'username', type: 'text', label: 'Username', required: true, placeholder: 'admin' },
        { name: 'password', type: 'password', label: 'Password', required: true },
        { name: 'displayName', type: 'text', label: 'Display Name', required: false, placeholder: 'Admin' },
      ],
      async onComplete(data) {
        const id = generateId()
        const now = new Date().toISOString()
        const pwHash = await hashPassword(data.password as string)
        ctx.db.run(sql`INSERT INTO users (id, username, display_name, password_hash, role, is_root_owner, is_agent, status, created_at, updated_at)
          VALUES (${id}, ${data.username as string}, ${(data.displayName as string) || (data.username as string)}, ${pwHash}, 'owner', 1, 0, 'active', ${now}, ${now})`)
      },
    })

    ctx.setup.registerStep({
      id: 'primary-agents',
      module: 'auth',
      title: 'Your two always-on AI teammates',
      description: 'EYAS starts with two permanent agents you\'ll work with every day: a Personal Assistant for your general work, and a System Engineer that runs and maintains EYAS itself. Give them names — you can add optional specialists next.',
      required: true,
      order: 20,
      fields: [
        { name: 'assistantName', type: 'text', label: 'Personal Assistant — your day-to-day AI teammate', required: true, placeholder: 'e.g. Jarvis' },
        { name: 'engineerName', type: 'text', label: 'System Engineer — keeps EYAS itself healthy', required: true, placeholder: 'e.g. R2D2' },
      ],
      async onComplete(data) {
        const { PRIMARY_TEMPLATES } = await import('@modules/agent/agent-templates.js')
        const { bootstrapAgentWorkspaceFromSeed } = await import('@modules/agent/workspace-bootstrap.js')
        const now = new Date().toISOString()
        const dataDir = (ctx.config as any)?.dataDir ?? 'data'

        const names = [data.assistantName as string, data.engineerName as string]

        for (let i = 0; i < PRIMARY_TEMPLATES.length; i++) {
          const template = PRIMARY_TEMPLATES[i]
          if (!template.workspaceSeed) {
            throw new Error(`Template ${template.id} is missing workspaceSeed — v2 setup requires it`)
          }
          const agentName = names[i]
          const agentDefId = generateId()
          const userId = generateId()
          const workspacePath = `data/agents/${agentDefId}`

          // Create agent_definitions record (v2 columns only — v1 columns left NULL).
          // The agent's mission/voice/rules now live in workspace files written below,
          // not in the SQL row.
          ctx.db.run(sql`INSERT INTO agent_definitions
            (id, name, description, tier, agent_type, model, max_turns, enabled, source, addressable, workspace_path, tools, created_at, updated_at)
            VALUES (
              ${agentDefId}, ${agentName}, ${template.description},
              ${template.tier}, ${template.agentType},
              ${template.model}, ${template.maxTurns},
              ${1}, ${'seed'}, ${1},
              ${workspacePath}, ${JSON.stringify(template.tools)}, ${now}, ${now}
            )`)

          // Materialize workspace files (IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md, SOUL.*)
          await bootstrapAgentWorkspaceFromSeed({
            dataDir,
            agentId: agentDefId,
            agentName,
            tier: template.tier,
            seed: template.workspaceSeed,
          })

          // Create linked user record for primary agents
          ctx.db.run(sql`INSERT INTO users
            (id, username, display_name, password_hash, role, is_root_owner, is_agent, agent_definition_id, status, created_at, updated_at)
            VALUES (${userId}, ${agentName.toLowerCase()}, ${agentName}, ${null}, 'agent', 0, 1, ${agentDefId}, 'active', ${now}, ${now})`)

          // Assign primary agents to their respective project types + seed projects
          if (i === 0) {
            ctx.db.run(sql`UPDATE project_types SET default_agent_id = ${agentDefId} WHERE id = 'general'`)
            ctx.db.run(sql`UPDATE projects SET default_agent_id = ${agentDefId} WHERE id = 'general-general'`)
          }
          if (i === 1) {
            ctx.db.run(sql`UPDATE project_types SET default_agent_id = ${agentDefId} WHERE id = 'eyas'`)
            ctx.db.run(sql`UPDATE projects SET default_agent_id = ${agentDefId} WHERE type_id = 'eyas'`)
          }
        }
      },
    })

    ctx.setup.registerStep({
      id: 'team-agents',
      module: 'auth',
      title: 'Team Agents',
      description: 'Select specialist agents for your team (can be changed later in Settings → Agents)',
      required: false,
      order: 25,
      fields: [
        { name: 'selectedAgents', type: 'text', label: 'Selected Agents (comma-separated IDs)', required: false,
          placeholder: 'devils-advocate,code-reviewer,test-engineer' },
      ],
      async onComplete(data) {
        const { applyTeamAgentSelection } = await import('@modules/agent/team-bootstrap.js')
        const selectedIds = (data.selectedAgents as string || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
        const dataDir = (ctx.config as any)?.dataDir ?? 'data'
        await applyTeamAgentSelection({ db: ctx.db, dataDir }, selectedIds)
      },
    })

    ctx.logger.info('Auth module registered')
  },

  async onStart(ctx: ModuleContext) {
    // JWT secret priority: config → secrets vault → generate + persist
    let jwtSecret = ctx.config.auth.jwtSecret

    if (!jwtSecret) {
      jwtSecret = await ctx.secrets.get('jwt-secret', 'system') ?? undefined
    }

    if (!jwtSecret) {
      const bytes = new Uint8Array(32)
      crypto.getRandomValues(bytes)
      jwtSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
      try {
        await ctx.secrets.set('jwt-secret', 'system', jwtSecret, 'auth')
        ctx.logger.info('JWT secret generated and stored in secrets vault')
      } catch {
        ctx.logger.warn('JWT secret auto-generated but could not be persisted (secrets not ready)')
      }
    }

    const tokenService = createTokenService(jwtSecret)

    createAuthRoutes(ctx.http, {
      db: ctx.db,
      registry: ctx.permissions,
      tokenService,
      sessionDuration: ctx.config.auth.sessionDuration,
      accessTokenDuration: ctx.config.auth.accessTokenDuration,
      refreshTokenDuration: ctx.config.auth.refreshTokenDuration,
      // D14 — lazy: ctx.wsRegistry is only created post-bootstrap in
      // main.ts/serve.ts (well after this onStart runs), so this resolves it
      // fresh at call time, same pattern as agent/index.ts's wsBroadcast.
      closeUserSockets: (userId: string) => { (ctx as any).wsRegistry?.closeUser(userId) },
    })

    // Register secrets routes AFTER auth routes (so authenticate middleware is applied first)
    createSecretsRoutes(ctx.http, () => ctx.secrets)

    // Register model routes AFTER auth middleware is wired
    createModelRoutes(ctx.http, ctx.model, undefined, ctx.providerConfig, ctx.providerReload, (ctx as any).reauthHealer, ctx.db)

    // Register routing routes AFTER auth middleware is wired
    if ((ctx as any)._pendingRoutingRoutes) {
      await (ctx as any)._pendingRoutingRoutes()
    }

    ctx.logger.info('Auth module started')
  },

  async onStop() {},
}
