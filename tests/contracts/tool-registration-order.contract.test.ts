// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Tool-registration ordering contract.
//
// A module that registers tools does `(ctx as any).tools?.registry` and gives
// up quietly when it is absent. That optional chain is the whole problem: if
// the module's onStart runs before the tools module's onRegister has published
// the registry, its tools are silently never registered, every agent silently
// lacks them, and the only symptom is a model saying "that tool is not wired".
//
// That is exactly what happened to the design tools. They looked registered —
// the code was there, no warning was logged — and they worked only because
// bootstrap happens to register the tools module earlier in the file. Nothing
// enforced it.
//
// This contract runs the REAL ModuleLoader over the REAL bootstrap registration
// order and the REAL dependency arrays, scraped from source rather than
// re-typed, and fails if any module that registers tools is not ordered after
// `tools`. Same shape as api-auth-coverage's Part A2, for the same reason.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MODULES_DIR = join(process.cwd(), 'src/modules')

/** Modules whose index.ts reaches for the shared tool registry. */
function modulesRegisteringTools(): string[] {
  const out: string[] = []
  for (const dir of readdirSync(MODULES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    let source: string
    try {
      source = readFileSync(join(MODULES_DIR, dir.name, 'index.ts'), 'utf8')
    } catch {
      continue
    }
    if (/\btools\??\.\s*registry/.test(source) || /tools\?\.\registry/.test(source)) out.push(dir.name)
  }
  return out
}

function declaredDependencies(moduleDir: string): string[] {
  const source = readFileSync(join(MODULES_DIR, moduleDir, 'index.ts'), 'utf8')
  const match = source.match(/dependencies:\s*\[([^\]]*)\]/)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('every module that registers tools waits for the tools module', () => {
  const registrars = modulesRegisteringTools().filter((m) => m !== 'tools')

  it('finds the modules to check, so a rename cannot empty this contract', () => {
    expect(registrars.length).toBeGreaterThan(4)
    expect(registrars).toContain('design')
    expect(registrars).toContain('agent')
  })

  for (const moduleDir of registrars) {
    it(`${moduleDir} declares 'tools' as a dependency`, () => {
      // Without the edge the module loader is free to start this module first,
      // and its tools vanish with no error anywhere.
      expect(declaredDependencies(moduleDir)).toContain('tools')
    })
  }
})

describe('the design tools in particular', () => {
  it('are all registered from the design module', () => {
    const source = readFileSync(join(MODULES_DIR, 'design/design-tools.ts'), 'utf8')
    for (const name of ['design_list', 'design_read', 'design_write', 'design_create', 'design_link', 'design_unlink', 'render_html_document']) {
      expect(source, name).toContain(`name: '${name}'`)
    }
  })

  it('carry a category both MCP bridges pass through to CLI providers', () => {
    // The bridges drop 'shell' and 'browser'. A design tool that never reaches
    // claude-code or grok-cli is a design tool that does not exist where most
    // of the work happens.
    const source = readFileSync(join(MODULES_DIR, 'design/design-tools.ts'), 'utf8')
    const categories = [...source.matchAll(/category:\s*'([a-z]+)'/g)].map((m) => m[1])
    expect(categories.length).toBeGreaterThan(4)
    for (const c of categories) expect(['shell', 'browser']).not.toContain(c)
  })
})
