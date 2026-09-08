// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync } from 'fs'
import { resolve } from 'path'

interface VersionInfo {
  version: string
  name: string
  codename: string
  releaseDate: string
}

let cached: VersionInfo | null = null

export function getVersionInfo(): VersionInfo {
  if (cached) return cached

  const raw = readFileSync(resolve(import.meta.dirname, '../../version.json'), 'utf-8')
  cached = JSON.parse(raw) as VersionInfo
  return cached
}

export function getVersion(): string {
  return getVersionInfo().version
}
