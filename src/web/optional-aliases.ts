// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// @saker/* is a `link:` dependency on a sibling editor that a public clone
// does not have. When the packages are missing, Vite aliases them to a stub
// so `build:web` still produces a UI (knowledge pages get a contenteditable).
//
// Aliases MUST be exact (`/^@saker\/ui$/`), not string prefix matches.
// Vite/Rollup treat `{ '@saker/ui': file }` as a prefix, so
// `@saker/ui/styles/editor.css` becomes `saker-stub.tsx/styles/editor.css`.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface OptionalAlias {
  find: string | RegExp
  replacement: string
}

function packageResolvable(webRoot: string, scopedName: string): boolean {
  const dir = join(webRoot, 'node_modules', ...scopedName.split('/'))
  const pkgJson = join(dir, 'package.json')
  if (!existsSync(pkgJson)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8')) as {
      module?: string
      main?: string
    }
    const candidates = [pkg.module, pkg.main, 'dist/index.js', 'index.js'].filter(
      (rel): rel is string => typeof rel === 'string' && rel.length > 0,
    )
    return candidates.some((rel) => existsSync(join(dir, rel)))
  } catch {
    return false
  }
}

export function optionalSakerAliases(webRoot: string): OptionalAlias[] {
  const stub = join(webRoot, 'src', 'lib', 'saker-stub.tsx')
  const stubCss = join(webRoot, 'src', 'lib', 'saker-stub.css')
  const aliases: OptionalAlias[] = []

  if (!packageResolvable(webRoot, '@saker/react')) {
    aliases.push({ find: /^@saker\/react$/, replacement: stub })
  }
  if (!packageResolvable(webRoot, '@saker/core')) {
    aliases.push({ find: /^@saker\/core$/, replacement: stub })
  }
  if (!packageResolvable(webRoot, '@saker/ui')) {
    aliases.push(
      { find: /^@saker\/ui\/styles\/editor\.css$/, replacement: stubCss },
      { find: /^@saker\/ui$/, replacement: stub },
    )
  }
  return aliases
}
