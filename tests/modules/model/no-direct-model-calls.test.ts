// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Contract (C12; findings MCI-1, MCI-12): a model is called through one of two
// doors, never a third.
//
// - The model gateway, directly, only for interactive work that must answer
//   on the model the user or the run chose: the agent loop, the conversation
//   stream route, the operator's model API, and the few interactive one-shots
//   listed below. Each one-shot must be isolated (no tools, one turn), and
//   every inline request it builds says so with `isolated: true`.
// - Everything else is a background call and goes through the auxiliary model
//   service (model/auxiliary.ts, ctx.auxiliaryModel): it picks an eligible
//   model, isolates the call and lets the caller fall back deterministically
//   when there is none. Narrow injected clients (planning's complete(), the
//   ops LlmClient, the email-triage LLMClient) are fine: the file that wires
//   one to a real model is where a gateway call would show up, and be caught.
//
// This is a syntactic scan (the TypeScript parser, no type checker): it finds
// every `.complete` / `.stream` read whose receiver is the gateway or a
// provider. A receiver counts as one by name (…gateway…, …provider…,
// ctx.model), by a declared type (ModelGateway, AIProvider) or by a same-file
// alias of either. A new call site outside ALLOWED fails the build, and so
// does an ALLOWED entry that no longer matches a call (a stale entry would
// quietly widen the door).

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = join(__dirname, '..', '..', '..')
const SRC = join(ROOT, 'src')

type Method = 'complete' | 'stream'
type Kind = 'gateway' | 'provider'
/** 'any': the file forwards or runs whatever request it has. 'isolated': every request is isolated. */
type Mode = 'any' | 'isolated'

interface Allowed {
  calls: Partial<Record<Method, Mode>>
  /** One line: why this file may call a model directly. */
  reason: string
}

const ALLOWED: Readonly<Record<string, Allowed>> = {
  // ── Interactive ──
  'src/modules/agent/agent-runner.ts': {
    calls: { stream: 'any' },
    reason: 'the agent loop: every conversation and agent turn, on the run binding',
  },
  'src/modules/conversations/routes.ts': {
    calls: { stream: 'any', complete: 'isolated' },
    reason: 'the chat stream route; plan-first writes the plan on the conversation model, isolated',
  },
  'src/modules/model/routes.ts': {
    calls: { complete: 'any', stream: 'any' },
    reason: 'POST /api/v1/model/complete|stream: the operator names the provider and model (CASL use Model)',
  },
  // ── Wrappers and the model module itself ──
  'src/modules/observability/trace-collector.ts': {
    calls: { complete: 'any', stream: 'any' },
    reason: 'the tracing wrapper forwards the call it wraps',
  },
  'src/modules/model/lazy-gateway.ts': {
    calls: { complete: 'any', stream: 'any' },
    reason: 'forwards to the gateway resolved at call time',
  },
  'src/modules/model/gateway.ts': {
    calls: { complete: 'any', stream: 'any' },
    reason: 'the gateway dispatches each attempt to the resolved provider',
  },
  'src/modules/model/auxiliary.ts': {
    calls: { complete: 'isolated' },
    reason: 'the auxiliary model service: the door every background call goes through',
  },
  // ── Isolated interactive one-shots ──
  'src/modules/agent/god-mode/orchestrator.ts': {
    calls: { complete: 'isolated' },
    reason: 'God Mode reviewer votes on its own roster model, tool-less',
  },
  'src/modules/design/design-ai.ts': {
    calls: { complete: 'isolated' },
    reason: 'the design editor completion on the install default, tool-less',
  },
}

/** Providers may delegate to their own adapter (a provider-kind call); none may call back into the gateway. */
const PROVIDER_SUBMODULES = 'src/modules/model/submodules/'

// ─── Scanner ──────────────────────────────────

interface ModelCallUse {
  path: string
  line: number
  method: Method
  kind: Kind
  receiver: string
  /** The call's first argument, when the read is called with an inline object literal. */
  literal?: { isolated: boolean }
  /** False when the method is read but not called (a reference, a bind). */
  called: boolean
}

interface FileScan {
  uses: ModelCallUse[]
  /** The file builds at least one object literal with `isolated: true`. */
  hasIsolatedLiteral: boolean
}

const TYPE_KIND: Array<[RegExp, Kind]> = [
  [/\bAIProvider\b/, 'provider'],
  [/\bModelGateway\b/, 'gateway'],
]

function kindOfType(typeText: string | undefined): Kind | null {
  if (!typeText) return null
  for (const [re, kind] of TYPE_KIND) if (re.test(typeText)) return kind
  return null
}

function kindOfName(text: string): Kind | null {
  const t = text.replace(/[\s!?]/g, '')
  if (/provider/i.test(t)) return 'provider'
  if (/gateway/i.test(t) || /(^|\.)ctx\.model$/.test(t)) return 'gateway'
  return null
}

function isTrue(node: ts.Expression | undefined): boolean {
  return node?.kind === ts.SyntaxKind.TrueKeyword
}

function literalIsIsolated(obj: ts.ObjectLiteralExpression): boolean {
  return obj.properties.some(
    (p) => ts.isPropertyAssignment(p) && p.name.getText() === 'isolated' && isTrue(p.initializer),
  )
}

function scanSource(path: string, source: string): FileScan {
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const aliases = new Map<string, Kind>()

  function unwrap(node: ts.Expression): { node: ts.Expression; asKind: Kind | null } {
    let n = node
    let asKind: Kind | null = null
    for (;;) {
      if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n)) n = n.expression
      else if (ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) {
        asKind ??= kindOfType(n.type.getText(sf))
        n = n.expression
      } else return { node: n, asKind }
    }
  }

  /** What an expression evaluates to: the gateway, a provider, or neither (as far as syntax can tell). */
  function kindOf(expr: ts.Expression): Kind | null {
    const { node, asKind } = unwrap(expr)
    if (asKind) return asKind
    if (ts.isIdentifier(node)) return aliases.get(node.text) ?? kindOfName(node.text)
    if (ts.isPropertyAccessExpression(node)) return kindOfName(node.getText(sf)) ?? aliases.get(node.name.text) ?? null
    if (ts.isElementAccessExpression(node)) return kindOf(node.expression)
    if (ts.isCallExpression(node)) return kindOf(node.expression)
    if (ts.isConditionalExpression(node)) return kindOf(node.whenTrue) ?? kindOf(node.whenFalse)
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return kindOf(node.left) ?? kindOf(node.right)
    }
    return null
  }

  /** Only value-like initializers make an alias: a function or object literal that merely mentions the gateway does not. */
  function kindOfInitializer(init: ts.Expression | undefined): Kind | null {
    if (!init) return null
    const { node, asKind } = unwrap(init)
    if (asKind) return asKind
    if (
      ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      || ts.isCallExpression(node) || ts.isConditionalExpression(node) || ts.isBinaryExpression(node)
    ) return kindOf(node)
    return null
  }

  function bindAlias(name: ts.Node, kind: Kind | null): void {
    if (kind && ts.isIdentifier(name)) aliases.set(name.text, kind)
  }

  /** `{ model } = ctx`, `{ model: gw }: ModuleContext` — the module context's gateway, destructured. */
  function bindContextPattern(pattern: ts.ObjectBindingPattern, source: string | undefined): void {
    if (!source || !/(^|\.)ctx$|\bModuleContext\b/.test(source.replace(/\s+/g, ''))) return
    for (const el of pattern.elements) {
      const prop = el.propertyName ?? el.name
      if (ts.isIdentifier(prop) && prop.text === 'model') bindAlias(el.name, 'gateway')
    }
  }

  // Pass 1: aliases (declarations, typed members, assignments).
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      const typeKind = kindOfType(node.type?.getText(sf))
      const init = 'initializer' in node ? node.initializer : undefined
      if (ts.isObjectBindingPattern(node.name)) {
        bindContextPattern(node.name, init?.getText(sf) ?? node.type?.getText(sf))
      } else {
        bindAlias(node.name, typeKind ?? kindOfInitializer(init))
      }
    } else if (ts.isPropertyAssignment(node)) {
      bindAlias(node.name, kindOfInitializer(node.initializer))
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = ts.isPropertyAccessExpression(node.left) ? node.left.name : node.left
      bindAlias(target, kindOfInitializer(node.right))
    }
    ts.forEachChild(node, collect)
  }
  collect(sf)

  // Pass 2: every read of .complete / .stream on a gateway or provider.
  const uses: ModelCallUse[] = []
  let hasIsolatedLiteral = false
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && literalIsIsolated(node)) hasIsolatedLiteral = true

    let method: string | undefined
    let receiver: ts.Expression | undefined
    if (ts.isPropertyAccessExpression(node)) {
      method = node.name.text
      receiver = node.expression
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      method = node.argumentExpression.text
      receiver = node.expression
    }
    if (receiver && (method === 'complete' || method === 'stream')) {
      const kind = kindOf(receiver)
      if (kind) {
        const call = ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : undefined
        const first = call?.arguments[0]
        uses.push({
          path,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          method,
          kind,
          receiver: receiver.getText(sf).replace(/\s+/g, ' '),
          called: Boolean(call),
          ...(first && ts.isObjectLiteralExpression(first) ? { literal: { isolated: literalIsIsolated(first) } } : {}),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { uses, hasIsolatedLiteral }
}

/** Violations for one file's scan, against the allowlist. */
function violationsFor(path: string, scan: FileScan, allowed: Readonly<Record<string, Allowed>> = ALLOWED): string[] {
  const out: string[] = []
  const entry = allowed[path]
  for (const use of scan.uses) {
    const at = `${use.path}:${use.line} ${use.receiver}.${use.method}`
    if (path.startsWith(PROVIDER_SUBMODULES) && use.kind === 'provider') continue
    const mode = entry?.calls[use.method]
    if (!mode) {
      out.push(`${at} — direct ${use.kind} call outside the allowlist; background work goes through ctx.auxiliaryModel`)
      continue
    }
    if (mode !== 'isolated') continue
    if (!use.called) {
      out.push(`${at} — an isolated-only file must call the model, not pass the method around`)
    } else if (use.literal ? !use.literal.isolated : !scan.hasIsolatedLiteral) {
      out.push(`${at} — the request must carry isolated: true`)
    }
  }
  return out
}

/** Allowlist entries that no longer match a call: each would silently widen the door. */
function staleEntries(scans: ReadonlyMap<string, FileScan>, allowed: Readonly<Record<string, Allowed>> = ALLOWED): string[] {
  const out: string[] = []
  for (const [path, entry] of Object.entries(allowed)) {
    for (const method of Object.keys(entry.calls) as Method[]) {
      if (!scans.get(path)?.uses.some((u) => u.method === method)) out.push(`${path} (${method})`)
    }
  }
  return out
}

// ─── The tree ─────────────────────────────────

function backendSources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    // The web bundle is a separate program with no gateway.
    if (name === 'node_modules' || full === join(SRC, 'web')) continue
    if (statSync(full).isDirectory()) out.push(...backendSources(full))
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const rel = (full: string) => relative(ROOT, full).split('\\').join('/')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const scans = new Map<string, FileScan>(backendSources(SRC).map((full) => [rel(full), scanSource(rel(full), readFileSync(full, 'utf8'))]))

describe('no direct model calls outside the allowlist (C12)', () => {
  it('scans the whole backend source, and sees the known call sites', () => {
    // A guard that walked nothing would be green for the wrong reason.
    expect(scans.size).toBeGreaterThan(500)
    expect(scans.get('src/modules/agent/agent-runner.ts')?.uses.some((u) => u.method === 'stream' && u.kind === 'gateway')).toBe(true)
  })

  it('the current tree has no direct model call outside the allowlist', () => {
    const offenders = [...scans].flatMap(([path, scan]) => violationsFor(path, scan))
    expect(offenders).toEqual([])
  })

  it('every allowlist entry still matches a call, and names its reason', () => {
    expect(staleEntries(scans)).toEqual([])
    for (const entry of Object.values(ALLOWED)) expect(entry.reason.length).toBeGreaterThan(10)
  })

  it('every isolated one-shot file builds an isolated request', () => {
    for (const [path, entry] of Object.entries(ALLOWED)) {
      if (Object.values(entry.calls).includes('isolated')) expect(scans.get(path)?.hasIsolatedLiteral, path).toBe(true)
    }
  })

  it('the auxiliary service and the narrow injected clients are not gateway calls', () => {
    const src = [
      'async function a(aux, deps, opts, handle) {',
      '  await aux.complete({ purpose: "title", user: "x" })',
      '  await deps.aux.complete({ purpose: "critic", user: "x" })',
      '  await opts.complete({ system: "s", user: "u" })',
      '  handle?.complete({ outcome: "ok" })',
      '  await this.llm.complete({ system: "s", user: "u" })',
      '  // ctx.model.complete( in a comment, and in a string:',
      '  return "ctx.model.complete("',
      '}',
    ].join('\n')
    expect(scanSource('src/modules/foo/bar.ts', src).uses).toEqual([])
  })
})

describe('the guard flags a new bypass', () => {
  const path = 'src/modules/foo/bar.ts'
  const flagged = (src: string) => violationsFor(path, scanSource(path, src))

  it('ctx.model.complete( in a non-allowlisted file', () => {
    const v = flagged('export const f = (ctx) => ctx.model.complete({ messages: [] })')
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('src/modules/foo/bar.ts:1 ctx.model.complete')
  })

  it('an isolated request does not buy a pass outside the allowlist', () => {
    expect(flagged('export const f = (ctx) => ctx.model.complete({ messages: [], isolated: true })')).toHaveLength(1)
  })

  it('the gateway reached by a getter, a typed field, an alias, a cast or destructuring', () => {
    const src = [
      'import type { ModelGateway } from "@modules/model/types"',
      'interface Deps { llmBackend: ModelGateway }',
      'export async function f(ctx, deps: Deps, getGateway: () => ModelGateway) {',
      '  await getGateway().complete({ messages: [] })',
      '  await deps.llmBackend.complete({ messages: [] })',
      '  const m = ctx.model',
      '  for await (const e of m.stream({ messages: [] })) void e',
      '  await (ctx.svc as ModelGateway).complete({ messages: [] })',
      '  const { model } = ctx',
      '  await model!.complete({ messages: [] })',
      '  await ctx.model["stream"]({ messages: [] })',
      '}',
    ].join('\n')
    expect(flagged(src)).toHaveLength(6)
  })

  it('a provider called directly, skipping the gateway', () => {
    const v = flagged('export const f = (gateway) => gateway.getProvider("x")!.complete({ messages: [] })')
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('direct provider call')
  })

  it('the method handed out as a reference', () => {
    expect(flagged('export const f = (ctx) => ({ complete: ctx.model.complete.bind(ctx.model) })')).toHaveLength(1)
  })

  it('a provider module calling back into the gateway, while delegating to its own adapter stays legal', () => {
    const p = 'src/modules/model/submodules/fake/provider.ts'
    const src = [
      'import type { AIProvider } from "../../types.js"',
      'export function wrap(base: AIProvider, gateway) {',
      '  return { complete: (r) => base.complete(r), stream: (r) => base.stream(r), x: (r) => gateway.complete(r) }',
      '}',
    ].join('\n')
    const v = violationsFor(p, scanSource(p, src))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('gateway.complete')
  })

  it('removing isolated: true from the God Mode reviewer is flagged', () => {
    const path = 'src/modules/agent/god-mode/orchestrator.ts'
    const real = read(path)
    expect(real).toContain('isolated: true,')
    expect(violationsFor(path, scanSource(path, real))).toEqual([])
    expect(violationsFor(path, scanSource(path, real.replace('isolated: true,', '')))).toHaveLength(1)
    expect(violationsFor(path, scanSource(path, real.replace('isolated: true,', 'isolated: false,')))).toHaveLength(1)
  })

  it('removing isolated: true from plan-first is flagged, while the stream route stays allowed', () => {
    const path = 'src/modules/conversations/routes.ts'
    const real = read(path)
    const stripped = real.replace(/isolated: true,(\s*signal: runSignal,)/, '$1')
    expect(stripped).not.toBe(real)
    const v = violationsFor(path, scanSource(path, stripped))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('.complete')
  })

  it('an allowlisted file calling a method it is not listed for', () => {
    const path = 'src/modules/design/design-ai.ts'
    const extra = `${read(path)}\nexport const s = (getGateway: () => ModelGateway) => getGateway().stream({ messages: [], isolated: true })\n`
    const v = violationsFor(path, scanSource(path, extra))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('.stream')
  })

  it('a stale allowlist entry is reported', () => {
    const allowed = { 'src/modules/foo/bar.ts': { calls: { complete: 'any' as const }, reason: 'a test entry with no call' } }
    const none = new Map([['src/modules/foo/bar.ts', scanSource('src/modules/foo/bar.ts', 'export const x = 1')]])
    expect(staleEntries(none, allowed)).toEqual(['src/modules/foo/bar.ts (complete)'])
    expect(staleEntries(new Map(), allowed)).toEqual(['src/modules/foo/bar.ts (complete)'])
  })
})
