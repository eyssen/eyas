// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Contract: effort has ONE resolver. Only the gateway writes a request's
// effortPlan (per attempt, after routing and failover). Every provider maps
// its wire parameter from that plan — never from the raw intent, and never
// from the old per-request thinking knob (ThinkingConfig / request.thinking
// and the shim that projected the plan onto it are gone, E7). Providers never
// author an effort outcome themselves — they can only confirm a runtime
// readback through readbackOutcome(). A second path that sets either would let
// a level reach a model it was never resolved for.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { mergeEffortOutcome, readbackOutcome } from '@modules/model/reasoning/outcome.js'
import type { EffortOutcome } from '@modules/model/reasoning/resolve.js'
import { effortPlanFor } from '../helpers/effort-plan.js'

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')
const GATEWAY = 'src/modules/model/gateway.ts'
const TYPES = 'src/modules/model/types.ts'
const SUBMODULES = 'src/modules/model/submodules/'

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    // The web bundle is a separate program; it never builds model requests.
    if (name === 'node_modules' || full === join(SRC, 'web')) continue
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** Source without comments, so a doc line naming the field is not an assignment. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const files = sourceFiles(SRC).map((full) => ({ path: relative(ROOT, full).split('\\').join('/'), text: code(full) }))
const providerFiles = files.filter((f) => f.path.startsWith(SUBMODULES))

/** One directory per provider family under submodules/. */
const families = readdirSync(join(ROOT, SUBMODULES)).filter((name) => statSync(join(ROOT, SUBMODULES, name)).isDirectory())
const familyFiles = (family: string) => providerFiles.filter((f) => f.path.startsWith(`${SUBMODULES}${family}/`))

/** `effortPlan: …` (object property) or `.effortPlan = …` — not an optional type member `effortPlan?:`. */
const ASSIGNS_PLAN = /(?:\beffortPlan\s*:(?!:)|\.effortPlan\s*=(?!=))/
/** Any write of an effort outcome (property or assignment), optional type members excluded. */
const WRITES_OUTCOME = /(?:\beffortOutcome\s*:(?!:)|\.effortOutcome\s*=(?!=))/g
/** The deleted per-request thinking knob and the shim that fed it from the plan. */
const LEGACY_THINKING = /\bThinkingConfig\b|\b(?:request|req)\s*(?:\?\.|\.)\s*thinking\b|\b(?:request|req)\s*\[\s*['"]thinking['"]\s*\]|legacy-shim|\btoLegacy(?:Effort|Thinking)\b|\bLegacyEffortLevel\b/
/** A read of the raw effort intent: a member access, a subscript, or a destructuring of the request. */
const READS_INTENT = /\b(?:request|req)\s*(?:\?\.|\.)\s*effort\b|\b(?:request|req)\s*\[\s*['"]effort['"]\s*\]|\{[^{}]*\beffort\b[^{}]*\}\s*=\s*(?:request|req)\b/
/**
 * A provider authoring outcome fields: naming the outcome type or the
 * gateway's merge, an outcome-only key (`clamped:` / `confirmed:`), spreading
 * a readback to override it, or mutating an outcome's fields afterwards.
 */
const AUTHORS_OUTCOME = /\bEffortOutcome\b|\bmergeEffortOutcome\b|\b(?:clamped|confirmed)\s*:(?!:)|\.\.\.\s*readbackOutcome\s*\(|\b\w*[oO]utcome\s*(?:\?\.|\.)\s*(?:requested|source|effective|clamped|confirmed|reason)\s*=(?!=)/
/** The CLI runtimes that report the level they really ran with (F5 Claude Code, F10 Grok, F11 Kimi). */
const READBACK_PROVIDERS = ['claude-code', 'grok-cli', 'kimi-cli']

describe('effort plan / outcome ownership', () => {
  it('scans the backend source', () => {
    expect(files.some((f) => f.path === GATEWAY)).toBe(true)
    expect(families).toEqual(expect.arrayContaining(['anthropic', 'claude-code', 'gemini', 'grok-cli', 'kimi-cli', 'ollama', 'openai']))
  })

  it('only the gateway assigns request.effortPlan', () => {
    const offenders = files.filter((f) => f.path !== GATEWAY && ASSIGNS_PLAN.test(f.text)).map((f) => f.path)
    expect(offenders, `effortPlan assigned outside ${GATEWAY}`).toEqual([])
    expect(ASSIGNS_PLAN.test(files.find((f) => f.path === GATEWAY)!.text)).toBe(true)
  })

  it('providers write response.effortOutcome only through readbackOutcome()', () => {
    const offenders: string[] = []
    for (const f of providerFiles) {
      for (const match of f.text.matchAll(WRITES_OUTCOME)) {
        const after = f.text.slice(match.index! + match[0].length).trimStart()
        if (!after.startsWith('readbackOutcome(')) offenders.push(`${f.path}: ${f.text.slice(match.index!, match.index! + 60)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no provider authors requested/source (or any other outcome field) itself', () => {
    const offenders = providerFiles
      .filter((f) => AUTHORS_OUTCOME.test(f.text))
      .map((f) => `${f.path}: ${f.text.match(AUTHORS_OUTCOME)![0]}`)
    expect(offenders).toEqual([])
  })

  it('the CLI runtimes confirm their effective level through readbackOutcome(request.effortPlan, …)', () => {
    for (const family of READBACK_PROVIDERS) {
      const provider = familyFiles(family).find((f) => f.path.endsWith('/provider.ts'))
      expect(provider, `${family}/provider.ts`).toBeDefined()
      expect(provider!.text, family).toMatch(/\breadbackOutcome\(\s*request\.effortPlan\b/)
    }
    // Such a readback is confirmed; the gateway's merge then keeps ITS
    // requested/source whatever the provider put there.
    const plan = effortPlanFor('max')
    const readback = readbackOutcome(plan, 'high')!
    expect(readback.confirmed).toBe(true)
    const gateway: EffortOutcome = { requested: 'max', effective: 'max', source: 'conversation', clamped: false }
    const forged = { ...readback, requested: 'low' as const, source: 'request' as const }
    expect(mergeEffortOutcome(gateway, forged)).toMatchObject({ requested: 'max', source: 'conversation', effective: 'high', confirmed: true })
  })

  it('outside the providers, only the gateway writes an effort outcome (through mergeEffortOutcome)', () => {
    const offenders: string[] = []
    for (const f of files.filter((file) => !file.path.startsWith(SUBMODULES) && file.path !== GATEWAY)) {
      if (f.text.match(WRITES_OUTCOME)) offenders.push(f.path)
    }
    expect(offenders).toEqual([])
    const gateway = files.find((f) => f.path === GATEWAY)!.text
    for (const match of gateway.matchAll(WRITES_OUTCOME)) {
      expect(gateway.slice(match.index! + match[0].length).trimStart().startsWith('mergeEffortOutcome(')).toBe(true)
    }
  })

  it('providers read the plan, never the raw intent', () => {
    const offenders = providerFiles
      .filter((f) => READS_INTENT.test(f.text))
      .map((f) => `${f.path}: ${f.text.match(READS_INTENT)![0]}`)
    expect(offenders).toEqual([])
  })

  it('every provider family maps from request.effortPlan (directly, or through the OpenAI wire it delegates to)', () => {
    const readsPlan = (family: string) => familyFiles(family).some((f) => /\beffortPlan\b/.test(f.text))
    const delegatesToOpenAI = (family: string) => familyFiles(family).some((f) =>
      /from\s+['"]\.\.\/openai\/provider\.js['"]/.test(f.text) && /\bcreateOpenAIProvider\(/.test(f.text))
    expect(readsPlan('openai')).toBe(true)
    const unmapped = families.filter((family) => !readsPlan(family) && !delegatesToOpenAI(family))
    expect(unmapped).toEqual([])
  })

  it('the per-request thinking knob and the legacy shim are gone from the backend', () => {
    const offenders = files
      .filter((f) => LEGACY_THINKING.test(f.text))
      .map((f) => `${f.path}: ${f.text.match(LEGACY_THINKING)![0]}`)
    expect(offenders).toEqual([])
    expect(existsSync(join(ROOT, 'src/modules/model/reasoning/legacy-shim.ts'))).toBe(false)
    const request = files.find((f) => f.path === TYPES)!.text.match(/export interface ModelRequest \{[\s\S]*?\n\}/)
    expect(request, 'ModelRequest in types.ts').not.toBeNull()
    expect(request![0]).toMatch(/\beffortPlan\?:/)
    expect(request![0]).not.toMatch(/\bthinking\??:/)
  })

  it('the patterns still catch what they guard against (guards the guard)', () => {
    // Legacy thinking knob.
    expect(LEGACY_THINKING.test('thinking?: ThinkingConfig')).toBe(true)
    expect(LEGACY_THINKING.test('if (request.thinking?.enabled)')).toBe(true)
    expect(LEGACY_THINKING.test("const t = req['thinking']")).toBe(true)
    expect(LEGACY_THINKING.test("import { toLegacyEffort } from '../../reasoning/legacy-shim.js'")).toBe(true)
    expect(LEGACY_THINKING.test('export interface GeminiThinkingConfig {')).toBe(false)
    expect(LEGACY_THINKING.test("if (plan.thinking === 'on') params.thinking = { type: 'adaptive' }")).toBe(false)
    // Raw intent.
    expect(READS_INTENT.test('const level = request.effort?.level')).toBe(true)
    expect(READS_INTENT.test("const e = request['effort']")).toBe(true)
    expect(READS_INTENT.test('const { effort, model } = request')).toBe(true)
    expect(READS_INTENT.test('applyOpenAIReasoning(params, request.effortPlan, dialect)')).toBe(false)
    expect(READS_INTENT.test('const { effort, thinking } = capabilities')).toBe(false)
    // Outcome authoring.
    expect(AUTHORS_OUTCOME.test("return { requested: 'high', effective: 'high', source: 'model', clamped: false }")).toBe(true)
    expect(AUTHORS_OUTCOME.test("effortOutcome: { ...readbackOutcome(plan, level), requested: 'max' }")).toBe(true)
    expect(AUTHORS_OUTCOME.test("effortOutcome.source = 'request'")).toBe(true)
    expect(AUTHORS_OUTCOME.test("import type { EffortOutcome } from '../../reasoning/resolve.js'")).toBe(true)
    expect(AUTHORS_OUTCOME.test('const effortOutcome = readbackOutcome(request.effortPlan, effortReadback.effective())')).toBe(false)
    expect(AUTHORS_OUTCOME.test("logger.warn({ requested: cliModel, resolved: id }, 'another model')")).toBe(false)
  })
})
