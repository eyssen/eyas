// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Contract: model calls have ONE provider protocol — AIProvider (types.ts),
// which the model module registers and the gateway calls. The old v2 adapter
// layer (ModelProvider / ProviderCapabilities / NormalizedRequest and the
// Anthropic/OpenAI/Gemini/Ollama *Adapter classes) had no production caller
// and carried its own thinking and cache logic; a copy of it coming back
// would be a second, untested path to a model.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')
// `eyas migrate run` imports scripts/migrate-prompts-v2.ts, so scripts/ is
// reachable from the CLI and held to the same rule.
const SCRIPTS = join(ROOT, 'scripts')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    // The web bundle is a separate program; it never calls a model provider.
    if (name === 'node_modules' || full === join(SRC, 'web')) continue
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Source without comments, so a note naming the deleted layer is not a use of it. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const files = [...sourceFiles(SRC), ...sourceFiles(SCRIPTS)]
  .map((full) => ({ path: relative(ROOT, full).split('\\').join('/'), text: code(full) }))

const DEAD_LAYER = /\bimplements\s+ModelProvider\b|\bModelProvider\b|\bNormalizedRequest\b|\bProviderCapabilities\b|\b(?:Anthropic|OpenAI|Gemini|Ollama)Adapter\b/

describe('one model provider protocol', () => {
  it('scans the backend source and the CLI-reachable scripts', () => {
    expect(files.some((f) => f.path === 'src/modules/model/types.ts')).toBe(true)
    expect(files.some((f) => f.path === 'scripts/migrate-prompts-v2.ts')).toBe(true)
  })

  it('the dead v2 adapter layer does not come back', () => {
    const offenders = files
      .filter((f) => DEAD_LAYER.test(f.text))
      .map((f) => `${f.path}: ${f.text.match(DEAD_LAYER)![0]}`)
    expect(offenders).toEqual([])
  })

  it('the pattern still catches the deleted layer (guards the guard)', () => {
    expect(DEAD_LAYER.test('export class AnthropicAdapter implements ModelProvider {')).toBe(true)
    expect(DEAD_LAYER.test('send(req: NormalizedRequest)')).toBe(true)
    expect(DEAD_LAYER.test('readonly capabilities: ProviderCapabilities')).toBe(true)
    // The Ollama wire helper the production provider uses is not the dead class.
    expect(DEAD_LAYER.test('const adapter = createOllamaAdapter(baseUrl)')).toBe(false)
    expect(DEAD_LAYER.test('export function createAnthropicProvider(apiKey: string): AIProvider {')).toBe(false)
  })

  it('the provider factories keep their pure wire helpers', () => {
    const adapter = (id: string) => files.find((f) => f.path === `src/modules/model/submodules/${id}/adapter.ts`)!.text
    expect(adapter('anthropic')).toMatch(/export function toAnthropicMessages\b/)
    expect(adapter('openai')).toMatch(/export function toOpenAIMessages\b/)
    expect(adapter('gemini')).toMatch(/export function toGeminiContents\b/)
    expect(adapter('ollama')).toMatch(/export function createOllamaAdapter\b/)
    expect(files.find((f) => f.path === 'src/modules/model/submodules/ollama/provider.ts')!.text).toMatch(/createOllamaAdapter\(/)
  })

  it('the adapter-parity test that pinned the dead layer is gone', () => {
    expect(existsSync(join(ROOT, 'tests/integration/provider-adapter-parity.test.ts'))).toBe(false)
  })
})
