// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve, sep } from 'node:path'
import { parseVaultFile, serializeVaultFile } from './frontmatter.js'
import type { VaultFrontmatter, VaultEntry } from '../types.js'

export function createVaultService(vaultPath: string) {
  mkdirSync(join(vaultPath, 'semantic'), { recursive: true })
  mkdirSync(join(vaultPath, 'procedural'), { recursive: true })
  mkdirSync(join(vaultPath, 'projects'), { recursive: true })

  const basePath = resolve(vaultPath)

  function resolvedPath(relativePath: string): string {
    const full = resolve(basePath, relativePath)
    if (!full.startsWith(basePath + sep) && full !== basePath) {
      throw new Error('Path traversal attempt detected')
    }
    return full
  }

  return {
    read(relativePath: string): VaultEntry | null {
      const fullPath = resolvedPath(relativePath)
      if (!existsSync(fullPath)) return null
      const raw = readFileSync(fullPath, 'utf-8')
      const parsed = parseVaultFile(raw)
      return { path: relativePath, ...parsed }
    },

    write(relativePath: string, frontmatter: VaultFrontmatter, content: string) {
      const fullPath = resolvedPath(relativePath)
      mkdirSync(dirname(fullPath), { recursive: true })
      const serialized = serializeVaultFile(frontmatter, content)
      writeFileSync(fullPath, serialized, 'utf-8')
    },

    delete(relativePath: string) {
      const fullPath = resolvedPath(relativePath)
      if (existsSync(fullPath)) unlinkSync(fullPath)
    },

    exists(relativePath: string): boolean {
      return existsSync(resolvedPath(relativePath))
    },

    listFiles(): string[] {
      const results: string[] = []
      function walk(dir: string) {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue
            walk(fullPath)
          } else if (entry.name.endsWith('.md')) {
            results.push(relative(vaultPath, fullPath))
          }
        }
      }
      walk(vaultPath)
      return results
    },

    getFileHash(relativePath: string): string | null {
      const fullPath = resolvedPath(relativePath)
      if (!existsSync(fullPath)) return null
      const stat = statSync(fullPath)
      return `${stat.size}-${stat.mtimeMs}`
    },

    getBasePath(): string {
      return vaultPath
    },

    /**
     * Create (or ensure) a per-project folder under `projects/<slug>/`.
     * Returns the folder path relative to the vault root.
     */
    ensureProjectFolder(projectSlug: string): string {
      const safe = projectSlug.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60)
      if (!safe || safe.startsWith('.')) throw new Error('Invalid project slug')
      const rel = `projects/${safe}`
      mkdirSync(resolvedPath(rel), { recursive: true })
      return rel
    },

    /** List all top-level project folders under projects/ — useful for UI pickers. */
    listProjects(): string[] {
      const projectsDir = join(basePath, 'projects')
      if (!existsSync(projectsDir)) return []
      return readdirSync(projectsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => e.name)
        .sort()
    },
  }
}

export type VaultService = ReturnType<typeof createVaultService>
