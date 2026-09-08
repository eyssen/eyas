// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * macOS Keychain read for TOTP seeds the operator stored outside EYAS.
 * Platform-specific on purpose — never import this from generic core paths
 * except through the secrets/TOTP seam.
 *
 * The password is never logged. A miss is `null`, not an exception.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface OsKeychainReadDeps {
  platform?: NodeJS.Platform
  execFile?: (
    file: string,
    args: string[],
    options: { timeout: number; encoding: BufferEncoding },
  ) => Promise<{ stdout: string; stderr: string }>
}

/**
 * `security find-generic-password -s <service> -w` (optional `-a <account>`).
 * Returns null on any other OS, a missing item, or a non-zero exit.
 */
export async function readOsKeychainPassword(
  service: string,
  account?: string,
  deps: OsKeychainReadDeps = {},
): Promise<string | null> {
  const platform = deps.platform ?? process.platform
  if (platform !== 'darwin') return null
  const name = service.trim()
  if (!name) return null
  const args = ['find-generic-password', '-s', name, '-w']
  if (account && account.trim()) {
    args.splice(1, 0, '-a', account.trim())
  }
  const run = deps.execFile ?? execFileAsync
  try {
    const { stdout } = await run('security', args, { timeout: 5_000, encoding: 'utf8' })
    const value = String(stdout ?? '').trim()
    return value || null
  } catch {
    return null
  }
}
