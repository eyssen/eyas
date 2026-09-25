// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Realpath for paths that may not exist yet. realpathSync only resolves a
// path that exists, so a NEW file under a symlinked folder (or a dangling
// link) would otherwise be judged by where it looks like it goes rather than
// where the write actually lands. Shared by the tool path jail
// (tools/builtin/path-utils.ts) and the memory-sovereignty path policy.

import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'

/** Same bound as the kernel's SYMLOOP_MAX on Linux. */
const MAX_SYMLINKS = 40

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}

function isMissing(err: unknown): boolean {
  const code = errCode(err)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function components(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

/**
 * Walk `abs` one component at a time, following every symlink (dangling ones
 * included); a component that does not exist yet is taken as it is.
 */
function walk(abs: string): string {
  let current = parse(abs).root || sep
  let pending = components(abs.slice(current.length))
  let links = 0
  while (pending.length > 0) {
    const name = pending.shift() as string
    if (name === '.') continue
    if (name === '..') {
      current = resolve(current, '..')
      continue
    }
    const next = join(current, name)
    let isLink = false
    try {
      isLink = lstatSync(next).isSymbolicLink()
    } catch (err) {
      if (!isMissing(err)) throw err
      // A missing component holds no link; keep walking, so a later '..'
      // steps back physically and any link after it is still followed.
      current = next
      continue
    }
    if (!isLink) {
      current = next
      continue
    }
    if (++links > MAX_SYMLINKS) {
      const loop = new Error(`too many symbolic links: ${abs}`) as NodeJS.ErrnoException
      loop.code = 'ELOOP'
      throw loop
    }
    // The link target is walked component by component like the rest of the
    // path — never resolved as text. A relative target continues from the
    // link's own folder (`current`), so a '..' in it goes through the
    // physical parent step above, after every link before it was followed:
    // `a -> 'sub/../x'` with `sub -> /elsewhere/deep` lands in /elsewhere/x.
    const link = readlinkSync(next)
    if (isAbsolute(link)) {
      current = parse(link).root || sep
      pending = [...components(link.slice(current.length)), ...pending]
    } else {
      pending = [...components(link), ...pending]
    }
  }
  return current
}

/**
 * The real location of `path`: the full realpath when it exists, otherwise
 * the realpath of the nearest existing ancestor with the missing tail
 * appended — following symlinks along the way, a dangling one included.
 * A relative path is taken against process.cwd().
 *
 * Throws only for what makes the location unknowable (EACCES, ELOOP); a
 * missing path is never an error.
 */
export function realpathBestEffort(path: string): string {
  // Not resolve(): that would fold a '..' after a symlink by text. The walk
  // below resolves every component physically.
  const abs = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`
  try {
    return realpathSync(abs)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  return walk(abs)
}
