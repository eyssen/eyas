// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// @saker/* is a `link:` dependency on a sibling editor that a public clone
// does not have. When the packages are missing, Vite aliases them to a stub
// so `build:web` still produces a UI (knowledge pages get a contenteditable).

import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function optionalSakerAliases(webRoot: string): Record<string, string> {
  const reactPkg = join(webRoot, 'node_modules', '@saker', 'react', 'package.json')
  if (existsSync(reactPkg)) return {}
  const stub = join(webRoot, 'src', 'lib', 'saker-stub.tsx')
  const stubCss = join(webRoot, 'src', 'lib', 'saker-stub.css')
  return {
    '@saker/react': stub,
    '@saker/core': stub,
    '@saker/ui': stub,
    '@saker/ui/styles/editor.css': stubCss,
  }
}
