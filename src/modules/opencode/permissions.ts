// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The OpenCode CASL subject: what each action lets a caller do, the built-in
// roles' defaults, and the one terminal check the HTTP routes and the
// terminal socket share.
//
// read   — see the OpenCode page: status, models and the saved settings;
//          list the caller's own terminals and close one of them (closing
//          only ends the caller's own terminal, so someone who lost the
//          terminal right can still close one left over from before).
// create — headless OpenCode, where the EYAS security gate answers every tool
//          call OpenCode asks for: the EYAS-memory API the OpenCode plugin
//          uses (POST /memory/search, /memory/expand) for a signed-in caller.
//          The `opencode_run` tool is authorized on the tool path instead —
//          the caller's `execute Tool`, the colleague's toolset, its red-tier
//          approval and the gate on every OpenCode tool call — and never
//          consults this subject, so a colleague's headless task runs in any
//          user's conversation whatever that user's OpenCode right is.
// manage — change the settings, and open or attach to an interactive terminal:
//          the OpenCode TUI or a plain shell. In the TUI the person at the
//          keyboard approves OpenCode's tool requests themselves (the gate
//          answers only EYAS-started headless tasks, developer-agent.ts), and
//          OpenCode has no kernel sandbox, so a TUI is effectively a shell as
//          the EYAS server's OS user — the owner's and an admin's by default.
//          CASL's `manage` also covers read and create.

import { sql } from 'drizzle-orm'
import type { ModuleContext } from '@core/types'
import type { RoleId } from '@modules/permissions/types'

export const OPENCODE_SUBJECT = 'OpenCode'

/** The CASL action an interactive terminal (TUI or shell) needs: open, attach. */
export const OPENCODE_TERMINAL_ACTION = 'manage'

/**
 * The subject as the module registers it (index.ts onRegister). The `user`
 * role had `create` until 0.8.31-beta, which opened the OpenCode TUI; built-in
 * role grants are not stored anywhere (every request rebuilds its ability from
 * these defaults, permissions/roles.ts), so the new default applies to every
 * install at its next start with nothing to migrate.
 */
export const OPENCODE_PERMISSIONS: {
  actions: string[]
  defaults: Partial<Record<RoleId, string[]>>
} = {
  actions: ['read', 'create', 'manage'],
  defaults: {
    owner: ['manage'],
    admin: ['manage'],
    user: ['read'],
    agent: ['create'],
    guest: [],
  },
}

interface Ability {
  can(action: string, subject: string): boolean
}

/**
 * Whether a user may open or attach to an OpenCode terminal now: an active
 * user whose role may manage OpenCode. The role is read fresh on every call
 * (a changed role or a suspended account counts at once); anything that
 * cannot be read denies.
 */
export function createTerminalAccess(deps: {
  /** The user's current role; undefined for a missing or inactive user. */
  roleOf: (userId: string) => string | undefined
  abilityFor: (role: string) => Ability
}): (userId: string) => boolean {
  return (userId) => {
    if (!userId) return false
    try {
      const role = deps.roleOf(userId)
      if (!role) return false
      return deps.abilityFor(role).can(OPENCODE_TERMINAL_ACTION, OPENCODE_SUBJECT)
    } catch {
      return false
    }
  }
}

/**
 * The current role of an active user, read fresh from the users table (as the
 * WS topic ACL reads it, auth/index.ts); undefined for a missing, suspended or
 * archived user.
 */
export function activeRoleOf(db: ModuleContext['db']): (userId: string) => string | undefined {
  return (userId) => {
    const rows = db.all(sql`SELECT role, status FROM users WHERE id = ${userId}`) as { role: string; status: string }[]
    const row = rows[0]
    return row && row.status === 'active' ? row.role : undefined
  }
}
