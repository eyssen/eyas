// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export function readPidFile(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null
  const raw = readFileSync(pidFile, 'utf-8').trim()
  const pid = parseInt(raw, 10)
  if (!Number.isFinite(pid) || pid <= 0) return null
  return pid
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function writePidFile(pidFile: string, pid: number): void {
  mkdirSync(dirname(pidFile), { recursive: true })
  writeFileSync(pidFile, `${pid}\n`, 'utf-8')
}

export function removePidFile(pidFile: string): void {
  try {
    if (existsSync(pidFile)) unlinkSync(pidFile)
  } catch {
    // best-effort
  }
}

/** Send SIGTERM, wait, then SIGKILL if still alive. Returns true if stopped. */
export async function stopProcess(pid: number, timeoutMs = 10_000): Promise<boolean> {
  if (!isProcessRunning(pid)) return true

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return true
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await Bun.sleep(100)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return !isProcessRunning(pid)
  }

  await Bun.sleep(200)
  return !isProcessRunning(pid)
}
