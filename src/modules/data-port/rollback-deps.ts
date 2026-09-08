// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { historyPath } from '@modules/prompt-wizard/workspace-paths.js'
import { PROJECT_TYPE_AGENT_ID } from './constants.js'
import { failureReason } from './errors.js'

/**
 * Workspace file id standing for a project type's prompt column, not a file on
 * disk. Lives here because the snapshot below is the only thing that has to
 * take it apart; the module imports it back for its own routing.
 */
export const PROJECT_TYPE_PREFIX = 'project-type:'
import type { EyasDb } from '@core/types'
import type { RollbackDeps } from './rollback.js'

/**
 * What an undo needs from the running server, in the shape a module context
 * happens to have. Every service is optional and read through a getter at call
 * time: a module that started after the importer is still seen, and one that is
 * switched off leaves its slot `undefined` — rollback then reports the item as
 * skipped instead of counting an unperformed deletion as done.
 *
 * Structural rather than `ModuleContext`, and in a module of its own, so the
 * two walls worth locking down — the asset-directory containment check and the
 * vault reader the edited-note guard depends on — can be exercised against a
 * real directory in a test. A factory buried inside `onStart` cannot be reached.
 */
export interface RollbackDepsHost {
  db: EyasDb
  logger?: { warn?: (o: unknown, m?: string) => void }
  memory?: {
    vault?: { delete: (path: string) => void; read?: (path: string) => unknown }
    /**
     * Where the vault lives, when it is not `<dataDir>/vault`. No module
     * publishes it today — the memory module hard-codes `data/vault`, which is
     * the same directory in the default configuration — so it exists for a host
     * whose data directory is moved.
     */
    vaultPath?: string
    indexer?: { indexAll: () => number; removeStale: () => void }
    episodic?: { delete: (id: string) => void }
  }
  skills?: {
    loader?: {
      delete: (id: string) => void
      get: (id: string) => { id: string; name: string; source: string } | null | undefined
    }
  }
  agents?: {
    registry?: {
      delete: (id: string) => void
      get: (id: string) => { id: string; source: string } | undefined
    }
  }
}

export interface BuildRollbackDepsInput {
  host: RollbackDepsHost
  dataDir: string
  readWorkspaceFile: (agentId: string, file: string) => string | null
  writeWorkspaceFile: (agentId: string, file: string, body: string) => Promise<void>
}

/**
 * Keep the project type's current prompt before a rollback reverts it (A15.5).
 * `writeWorkspaceTarget` writes that column directly, so the workspace writer
 * never snapshots it; without this the pre-rollback text would be unrecoverable.
 * Best effort — a snapshot that cannot be written must not stop the undo.
 *
 * Here rather than in the module's `onStart` closure so the one thing that
 * makes a project-type revert reversible can be exercised against a real
 * directory. Returns the file it wrote, or `null` when it could not.
 */
export function snapshotProjectTypePrompt(
  dataDir: string,
  file: string,
  body: string,
  logger?: { warn: (o: unknown, m?: string) => void },
): string | null {
  try {
    const typeId = file.slice(PROJECT_TYPE_PREFIX.length).replace(/[^A-Za-z0-9._-]+/g, '-')
    const snapshot = historyPath(
      PROJECT_TYPE_AGENT_ID,
      `project-type-${typeId}`,
      new Date().toISOString(),
      dataDir,
    )
    mkdirSync(dirname(snapshot), { recursive: true })
    writeFileSync(snapshot, body, 'utf-8')
    return snapshot
  } catch (err) {
    logger?.warn({ err: failureReason(err), file }, 'data-port: project-type prompt snapshot failed')
    return null
  }
}

/**
 * Removes one bundled-asset directory, and only from inside the imported-skills
 * root. The second wall behind rollback's own check: a path that does not
 * resolve into that tree is a directory this import did not make, and reaching
 * here with one means a caller bypassed the first guard — worth failing loudly
 * rather than reporting as "nothing to remove".
 *
 * Answers `true` when a directory was there and is now gone, `false` when there
 * was nothing left to remove.
 */
export function removeImportedAssetDir(
  dataDir: string,
  dir: string,
  logger?: { warn?: (o: unknown, m?: string) => void },
): boolean {
  const root = resolve(dataDir, 'skills', 'imported')
  const full = resolve(dir)
  if (!full.startsWith(root + sep)) {
    logger?.warn?.(
      { dir },
      'data-port: asset directory outside the imported skills root — not removed',
    )
    throw new Error('asset directory outside the imported skills root')
  }
  // lstat, not existsSync: a dangling symlink is still something to unlink.
  try {
    lstatSync(full)
  } catch {
    return false
  }
  rmSync(full, { recursive: true, force: true })
  return true
}

/** The production `RollbackDeps`, wired to whatever the server has running. */
export function buildRollbackDeps(input: BuildRollbackDepsInput): RollbackDeps {
  const { host, dataDir } = input
  return {
    db: host.db,
    dataDir,
    get vault() {
      const vault = host.memory?.vault
      return vault
        ? {
            delete: (path: string) => vault.delete(path),
            // The edited-note guard compares the note's body against the digest
            // the ledger recorded; without a reader it cannot, and the tag
            // check decides alone.
            ...(vault.read ? { read: (path: string) => vault.read!(path) } : {}),
            // The note's actual bytes, frontmatter included — the parsed reader
            // has already taken that block off, and it says which pre-amendment
            // shape a digest recorded before R11.5 was taken over.
            //
            // The memory module writes the vault at `data/vault` relative to the
            // working directory; a host that puts it elsewhere must publish
            // `vaultPath`. Getting it wrong costs nothing: the read answers
            // `null` and the parsed reader — verbatim since round 2 — decides on
            // the same four digest shapes.
            readRaw: (path: string) => {
              try {
                return readFileSync(join(host.memory?.vaultPath ?? join(dataDir, 'vault'), path), 'utf-8')
              } catch {
                return null
              }
            },
          }
        : undefined
    },
    get indexer() {
      const indexer = host.memory?.indexer
      return indexer
        ? { indexAll: () => indexer.indexAll(), removeStale: () => indexer.removeStale() }
        : undefined
    },
    get episodic() {
      const episodic = host.memory?.episodic
      return episodic ? { delete: (id: string) => episodic.delete(id) } : undefined
    },
    get skills() {
      const loader = host.skills?.loader
      if (!loader) return undefined
      return {
        delete: (id: string) => loader.delete(id),
        // Provenance travels with the row; rollback deletes user-owned skills only.
        get: (id: string) => {
          const skill = loader.get(id)
          return skill ? { id: skill.id, name: skill.name, source: skill.source } : null
        },
      }
    },
    get agents() {
      const registry = host.agents?.registry
      if (!registry) return undefined
      return {
        delete: (id: string) => registry.delete(id),
        get: (id: string) => {
          const agent = registry.get(id)
          return agent ? { id: agent.id, source: agent.source } : null
        },
      }
    },
    removeAssetDir: (dir) => removeImportedAssetDir(dataDir, dir, host.logger),
    readWorkspaceFile: (agentId, file) => input.readWorkspaceFile(agentId, file),
    writeWorkspaceFile: (agentId, file, body) => input.writeWorkspaceFile(agentId, file, body),
  }
}
