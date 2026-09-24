// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { extname, isAbsolute, normalize, resolve, sep } from 'node:path'

const ALLOWED_WRITE_EXT = new Set([
  '.html', '.css', '.js', '.mjs', '.json', '.md', '.svg', '.txt', '.csv',
  '.wav', '.mp3', '.ogg', '.srt', '.ass',
])

export function resolveProjectPath(projectDir: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error('Invalid path')
  }
  if (isAbsolute(relativePath)) {
    throw new Error('Path must be relative to the project')
  }
  const normalized = normalize(relativePath)
  const parts = normalized.split(/[/\\]/)
  if (parts.includes('..') || normalized.startsWith('..')) {
    throw new Error('Path escapes the project directory')
  }
  const root = resolve(projectDir)
  const full = resolve(root, normalized)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (full !== root && !full.startsWith(prefix)) {
    throw new Error('Path escapes the project directory')
  }
  return full
}

export function assertAllowedWrite(relativePath: string): void {
  const ext = extname(relativePath).toLowerCase()
  if (!ALLOWED_WRITE_EXT.has(ext)) {
    throw new Error(`File type ${ext || '(none)'} is not allowed`)
  }
}

export const MAX_WRITE_CHARS = 1_000_000
