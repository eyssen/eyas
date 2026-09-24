// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const SENSITIVE_BASENAME_RE =
  /^(master\.key|\.env(\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i

const SENSITIVE_PATH_RE =
  /(^|[\\/])(\.ssh|data[\\/]sqlite)([\\/]|$)|master\.key|\.env(\.[A-Za-z0-9_-]+)?(?=$|[\\/])/i

const SKIP_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.git',
  '.Trash',
  '.trashes',
  '.ssh',
])

const MAX_ENTRIES = 400

export interface BrowseEntry {
  name: string
  path: string
}

export interface BrowseListing {
  path: string
  parent: string | null
  home: string
  entries: BrowseEntry[]
  truncated: boolean
}

function isSensitive(abs: string): boolean {
  const base = abs.split(/[\\/]/).pop() ?? ''
  return SENSITIVE_BASENAME_RE.test(base) || SENSITIVE_PATH_RE.test(abs)
}

function resolveExistingDir(abs: string): string {
  const real = existsSync(abs) ? realpathSync(abs) : abs
  if (!existsSync(real)) throw new Error(`directory does not exist: ${abs}`)
  const st = statSync(real)
  if (!st.isDirectory()) throw new Error(`path is not a directory: ${abs}`)
  if (isSensitive(real)) throw new Error('path touches a sensitive location')
  return real
}

export function listDirectories(rawPath?: string | null): BrowseListing {
  const home = homedir()
  const requested = (rawPath ?? '').trim()
  if (requested && !isAbsolute(requested)) {
    throw new Error('path must be absolute')
  }
  const target = resolveExistingDir(requested ? resolve(requested) : home)

  let names: string[]
  try {
    names = readdirSync(target)
  } catch {
    throw new Error(`cannot read directory: ${target}`)
  }

  const entries: BrowseEntry[] = []
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (SKIP_NAMES.has(name)) continue
    const full = join(target, name)
    if (isSensitive(full)) continue
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    entries.push({ name, path: full })
    if (entries.length >= MAX_ENTRIES) break
  }

  const parentDir = dirname(target)
  const parent = parentDir && parentDir !== target ? parentDir : null

  return {
    path: target,
    parent,
    home,
    entries,
    truncated: entries.length >= MAX_ENTRIES,
  }
}
