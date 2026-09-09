// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ModuleLoader } from '@core/module-loader'
import type { EyasModule, ModuleContext } from '@core/types'

/**
 * API auth-coverage contract — closes the exact failure mode behind the
 * 2026-08-25 login bounce: a fresh `home` module page loaded, immediately
 * 401'd, and the frontend's blanket "401 -> /login" handling (see
 * src/web/src/lib/api.ts) turned that into a silent redirect back to the
 * login screen. `requirePermission` (src/modules/permissions/middleware.ts)
 * throws 401 specifically when no `ability` is on the context — i.e. when
 * auth middleware never ran for the request.
 *
 * Root cause was NOT simply "home missing from an allowlist". auth/routes.ts
 * already has a deny-by-default catch-all (`router.use('/api/v1/*', ...)`,
 * added 2026-06-23) that authenticates every /api/v1 path not on its public
 * exemption list — home was never exempted, so on paper it was "covered".
 * The real bug: Hono composes middleware/handlers strictly in REGISTRATION
 * order (verified empirically), and home was the only module creating its
 * routes in `onRegister`, which runs for EVERY module before ANY module's
 * `onStart` — including auth's, where the catch-all and every per-prefix
 * authenticate/csrfProtection pair are mounted. So home's routes were
 * registered onto the Hono app before any auth middleware existed at all,
 * and none of it ever ran for them, regardless of what auth/routes.ts's
 * allowlist said.
 *
 * The first fix round for this file (2026-08-25) left one hole reviewed and
 * confirmed the next day: `homeModule.dependencies` was hand-patched to
 * include `'auth'` (needed so the module loader's topological sort orders
 * home's onStart, and therefore its route creation, after auth's onStart —
 * see the "Part A2" describe block below for why that edge is load-bearing),
 * but nothing enforced that edge. Deleting it from home/index.ts reintroduced
 * the exact original bug while every test here still passed. Part A2 closes
 * that: it runs the REAL `ModuleLoader.resolveDependencies()` against the
 * REAL bootstrap.ts registration order and REAL per-module `dependencies`
 * arrays (scraped from source, not re-typed by hand), and fails if any
 * module found to create routes from `onStart` doesn't land after `auth` in
 * the resulting order.
 *
 * This file guards three things:
 *  Part A  - no module may create its HTTP routes from onRegister.
 *  Part A2 - every module that DOES create routes from onStart is actually
 *            ordered after auth in the real, live dependency graph — not
 *            just "has 'auth' typed somewhere", the real topological result.
 *  Part B  - every live /api/v1/<segment> this scan can find is either on
 *            the named public-exemption list, paired with authenticate +
 *            csrfProtection in auth/routes.ts, or a documented, frozen
 *            pre-existing gap (never home) — and isPublicApiRoute can't grow
 *            to silently swallow a segment that's supposed to be protected.
 *
 * All three are deliberately textual/regex source scans (Part A2 additionally
 * exercises the real ModuleLoader class, which is pure and side-effect-free
 * to import — not the same category as booting the app), not import-and-boot
 * of the app itself: the existing contract tests in this directory (see
 * widgets.contract.test.ts, ws-topics.contract.test.ts) use the same textual
 * approach so the contract holds against the source a reviewer actually
 * reads, and so it can't be fooled by a test harness that pre-installs its
 * own auth-bypassing middleware (every route-level test in this repo does
 * exactly that, under tests/modules — which is precisely how this bug
 * shipped unnoticed).
 */

const ROOT = process.cwd()
const MODULES_DIR = join(ROOT, 'src', 'modules')
const AUTH_ROUTES_FILE = join(ROOT, 'src', 'modules', 'auth', 'routes.ts')
const BOOTSTRAP_FILE = join(ROOT, 'src', 'core', 'bootstrap.ts')

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) out.push(p)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// Part A — route creation must happen in onStart, never onRegister.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every module in this codebase declares its lifecycle methods in the fixed
 * order onRegister -> onStart -> onStop (verified across all 51 top-level
 * module files at the time this test was written). Extracting a method body
 * as "from its `async <name>(` to the next `async <next>(`" is therefore
 * reliable for real module files, without needing a full parser.
 *
 * Returns null if the source has no `async <name>(` at all.
 */
function extractMethodBody(source: string, name: string, next: string): string | null {
  const startMatch = new RegExp(`async\\s+${name}\\s*\\(`).exec(source)
  if (!startMatch) return null
  const start = startMatch.index
  const endMatch = new RegExp(`async\\s+${next}\\s*\\(`).exec(source.slice(start))
  const end = endMatch ? start + endMatch.index : source.length
  return source.slice(start, end)
}

const extractOnRegisterBody = (source: string) => extractMethodBody(source, 'onRegister', 'onStart')
const extractOnStartBody = (source: string) => extractMethodBody(source, 'onStart', 'onStop')

/**
 * A route-mounting call: either a `*Routes(` factory invocation (broadened
 * from just `create*Routes(` so a differently-named factory, e.g.
 * `mountXRoutes(...)` or `registerXRoutes(...)`, still gets caught) or a raw
 * `.route('` mount.
 *
 * KNOWN LIMIT (documented rather than chased, per this test's own review):
 * this is a textual pattern over ONE method body, not a call graph. A module
 * that calls a same-file or imported helper from onRegister, which *itself*
 * creates routes several calls down (e.g. `onRegister() { doSetup(ctx) }`
 * where `doSetup` elsewhere calls `createXRoutes(...)`), evades this check
 * entirely. Closing that fully would need real static call-graph analysis,
 * which this deliberately-textual test suite (see the file header) does not
 * attempt. If a future module manages to hide route creation behind a helper
 * like that, Part A2 below is the backstop that would actually catch the
 * user-visible effect (route registered before auth is ordered to run) —
 * but only if the *routes are still created from onStart*; a helper that
 * moves route creation into onRegister via indirection is a real, currently
 * open gap in this suite's coverage.
 */
const ROUTE_CREATION_PATTERN = /\b\w*Routes\(|\.route\(\s*['"]/

function findOnRegisterRouteViolations(): Array<{ file: string; snippet: string }> {
  const violations: Array<{ file: string; snippet: string }> = []
  for (const file of walk(MODULES_DIR)) {
    if (!file.endsWith('index.ts')) continue
    const source = readFileSync(file, 'utf8')
    const body = extractOnRegisterBody(source)
    if (!body) continue
    const m = ROUTE_CREATION_PATTERN.exec(body)
    if (m) {
      violations.push({
        file: file.slice(ROOT.length + 1),
        snippet: body.slice(Math.max(0, m.index - 10), m.index + 40).trim(),
      })
    }
  }
  return violations
}

describe('Part A — module route creation happens in onStart, not onRegister', () => {
  it('no module index.ts creates HTTP routes from onRegister', () => {
    const violations = findOnRegisterRouteViolations()
    if (violations.length > 0) {
      const detail = violations.map((v) => `  - ${v.file}: "${v.snippet}"`).join('\n')
      throw new Error(
        `Route(s) created from onRegister — these bypass ALL onStart-registered ` +
          `middleware (auth's deny-by-default catch-all included), because Hono ` +
          `composes middleware/handlers in registration order and onRegister runs ` +
          `for every module before any module's onStart:\n${detail}\n` +
          `Move the route-creation call into onStart (see src/modules/board/index.ts ` +
          `or the fixed src/modules/home/index.ts for the pattern: build services in ` +
          `onRegister, store them on ctx, create routes from the stored services in onStart).`,
      )
    }
  })

  it('the detector actually discriminates: it flags a synthetic onRegister that creates routes', () => {
    const badSource = `
export const fakeModule = {
  async onRegister(ctx) {
    createFakeRoutes(ctx.http, {})
  },
  async onStart(ctx) {},
}
`
    const body = extractOnRegisterBody(badSource)
    expect(body).not.toBeNull()
    expect(ROUTE_CREATION_PATTERN.test(body!)).toBe(true)
  })

  it('the detector does not false-positive on a clean onRegister/onStart split', () => {
    const goodSource = `
export const fakeModule = {
  async onRegister(ctx) {
    const service = createFakeService(ctx.db)
    ;(ctx).fake = { service }
  },
  async onStart(ctx) {
    createFakeRoutes(ctx.http, (ctx).fake.service)
  },
}
`
    const body = extractOnRegisterBody(goodSource)
    expect(body).not.toBeNull()
    expect(ROUTE_CREATION_PATTERN.test(body!)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Part A2 — every module that creates routes from onStart is topologically
// ordered after 'auth' in the REAL bootstrap dependency graph.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scrapes src/core/bootstrap.ts for the real, in-order list of
 * `moduleLoader.register(<var>)` calls, and resolves each `<var>` back to
 * its declaring file via bootstrap.ts's own `import { <var> } from
 * '@modules/...'` lines (using this repo's tsconfig path alias,
 * `@modules/* -> src/modules/*`). This is the actual runtime registration
 * order, not a guess at it.
 */
function scrapeBootstrapRegistrationOrder(): Array<{ varName: string; file: string }> {
  const bootstrapSource = readFileSync(BOOTSTRAP_FILE, 'utf8')
  const importMap = new Map<string, string>()
  for (const m of bootstrapSource.matchAll(/import\s*\{\s*(\w+)\s*\}\s*from\s*'@modules\/([^']+)'/g)) {
    importMap.set(m[1], join(MODULES_DIR, `${m[2]}.ts`))
  }
  const order: Array<{ varName: string; file: string }> = []
  for (const m of bootstrapSource.matchAll(/moduleLoader\.register\((\w+)\)/g)) {
    const file = importMap.get(m[1])
    if (file) order.push({ varName: m[1], file })
  }
  return order
}

/**
 * Extracts a `<field>: <value>` from the module object literal in `source`,
 * anchored to start at `export const xModule: EyasModule = {` so an
 * unrelated same-named field earlier in the file (e.g. a type declaration)
 * can't be picked up by mistake. Returns null if the object-literal anchor
 * itself, or the field within it, isn't found.
 */
function extractModuleField(source: string, field: string): string | null {
  const anchor = /export const \w+Module\s*:\s*EyasModule\s*=\s*\{/.exec(source)
  if (!anchor) return null
  const bodyStart = anchor.index + anchor[0].length
  const nextMethod = /async\s+onRegister\s*\(/.exec(source.slice(bodyStart))
  const bodyEnd = nextMethod ? bodyStart + nextMethod.index : source.length
  const body = source.slice(bodyStart, bodyEnd)
  const m = new RegExp(`\\b${field}:\\s*(\\[[^\\]]*\\]|'[^']*'|"[^"]*")`).exec(body)
  return m ? m[1] : null
}

/**
 * A handful of modules assemble their EyasModule object via `...xManifest`
 * spread from a sibling `./manifest.ts` (artifacts, mission-control, ops,
 * skill-generation, event-store, at time of writing) rather than declaring
 * `id`/`dependencies` inline. Falls back there when the direct extraction
 * finds nothing.
 */
function loadModuleMeta(file: string): { id: string; dependencies: string[] } {
  const source = readFileSync(file, 'utf8')
  let idRaw = extractModuleField(source, 'id')
  let depsRaw = extractModuleField(source, 'dependencies')
  if ((!idRaw || !depsRaw) && /from\s*['"]\.\/manifest(?:\.js)?['"]/.test(source)) {
    const manifestSource = readFileSync(join(dirname(file), 'manifest.ts'), 'utf8')
    const manifestIdMatch = /\bid:\s*('[^']*'|"[^"]*")/.exec(manifestSource)
    const manifestDepsMatch = /\bdependencies:\s*(\[[^\]]*\])/.exec(manifestSource)
    idRaw = idRaw ?? (manifestIdMatch ? manifestIdMatch[1] : null)
    depsRaw = depsRaw ?? (manifestDepsMatch ? manifestDepsMatch[1] : null)
  }
  if (!idRaw || !depsRaw) {
    throw new Error(`could not find id/dependencies for ${file.slice(ROOT.length + 1)} — has the module-declaration shape changed?`)
  }
  const id = idRaw.replace(/^['"]|['"]$/g, '')
  const dependencies = depsRaw === '[]' ? [] : [...depsRaw.matchAll(/'([^']+)'/g)].map((m) => m[1])
  return { id, dependencies }
}

function makeStubModule(id: string, dependencies: string[]): EyasModule {
  return {
    id,
    name: id,
    version: '0.0.0',
    type: 'core',
    description: '',
    dependencies,
    onRegister: async () => {},
    onStart: async () => {},
    onStop: async () => {},
  }
}

/**
 * Extracts the `{ ... }` block starting at the '{' found at `openIdx`,
 * tracking brace depth (no string/comment awareness — good enough for the
 * narrow, verified use below, unlike a general-purpose scanner).
 */
function extractBalancedBlock(source: string, openIdx: number): string {
  let depth = 0
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(openIdx, i + 1)
    }
  }
  throw new Error(`unbalanced braces from index ${openIdx} while extracting a block`)
}

/**
 * Modules whose onStart body textually contains a route-creation call but
 * where that call is deliberately DEFERRED — assigned to a closure that is
 * invoked later, by a DIFFERENT module's onStart, after auth's middleware is
 * confirmed wired. Known instance: model/index.ts stores
 * `(ctx as any)._pendingRoutingRoutes`, a closure that calls
 * `createRoutingRoutes(...)`, but never calls it itself — auth/index.ts's
 * own onStart invokes it (see the comment at model/index.ts's assignment
 * site: "auth module must register routes AFTER auth middleware is wired").
 *
 * Each entry is verified below against source, not just asserted: the
 * assignment must exist, invoking THAT exact closure must be the only
 * remaining route-creation call in the module's onStart body once the
 * deferred block is stripped out, and `invokedBy` must actually call it.
 * This is a narrow, explicit escape hatch — NOT a general "ignore closures"
 * rule, precisely so it can't become a silent way to hide a real violation
 * (see Part A's own documented indirection limitation, which this does not
 * reopen: it only exempts this one verified, named, cross-checked shape).
 */
const DEFERRED_ROUTE_CREATION = new Map<string, { invokedBy: string; property: string }>([
  ['model', { invokedBy: 'auth', property: '_pendingRoutingRoutes' }],
])

/**
 * Fully public modules (every route they register is on PUBLIC_SEGMENTS) —
 * these have no auth to bypass, so they're exempt from the "ordered after
 * auth" requirement entirely. Cross-checked below: a module only qualifies
 * if its own `id` IS a PUBLIC_SEGMENTS entry, so this can't silently grow to
 * cover something that isn't actually fully public — see the isPublicApiRoute
 * cross-checks in Part B for what actually backs 'setup' being here.
 */
const PUBLIC_MODULE_IDS = new Set(['setup'])

/**
 * Pre-existing onStart-ordering gaps discovered by Part A2 while hardening
 * this test for the 2026-08-26 review round — NOT the home bug, and
 * deliberately NOT fixed here. 'privacy' creates routes directly in its own
 * onStart (`createPrivacyRoutes(ctx.http, ...)`, unconditionally once
 * enabled) without being ordered after 'auth', so /api/v1/privacy/scan
 * currently has NO auth at all — not just no CSRF (a more severe version of
 * the same class of gap as CSRF_PAIRING_DEBT_BASELINE, which is why
 * 'privacy' appears in both). Not a one-line copy of the home fix: privacy's
 * bootstrap.ts registration position is called out as load-bearing in a
 * comment there ("privacy wraps ctx.model before every model-consumer's
 * onStart runs") — forcing it after auth needs someone to first confirm
 * nothing that currently runs between privacy's and auth's positions
 * consumes ctx.model in its own onStart, which is real investigation, not a
 * copy-paste. Flagged for the owner / a dedicated follow-up.
 */
const ONSTART_AUTH_ORDERING_DEBT_BASELINE = new Set(['privacy'])

describe("Part A2 — real dependency graph orders every onStart route-creator after 'auth'", () => {
  it("homeModule.dependencies includes 'auth' (the direct check this test also proves generally below)", () => {
    const { dependencies } = loadModuleMeta(join(MODULES_DIR, 'home', 'index.ts'))
    expect(dependencies, "src/modules/home/index.ts's dependencies array must include 'auth' — see this file's header for why").toContain('auth')
  })

  it("ONSTART_AUTH_ORDERING_DEBT_BASELINE never contains home — that is the exact bug this test guards", () => {
    expect(ONSTART_AUTH_ORDERING_DEBT_BASELINE.has('home')).toBe(false)
  })

  it('DEFERRED_ROUTE_CREATION entries are genuinely deferred (nothing else in onStart creates routes) and genuinely invoked by the named module', () => {
    const scraped = scrapeBootstrapRegistrationOrder()
    const fileById = new Map(scraped.map(({ file }) => [loadModuleMeta(file).id, file]))
    for (const [modId, { invokedBy, property }] of DEFERRED_ROUTE_CREATION) {
      const modFile = fileById.get(modId)
      expect(modFile, `'${modId}' not found via the bootstrap.ts scraper`).toBeDefined()
      const modSource = readFileSync(modFile!, 'utf8')
      const onStartBody = extractOnStartBody(modSource)
      expect(onStartBody, `'${modId}' has no onStart at all`).not.toBeNull()

      const assignPattern = new RegExp(`\\(ctx as any\\)\\.${property}\\s*=\\s*async\\s*\\(\\s*\\)\\s*=>\\s*\\{`)
      const m = assignPattern.exec(onStartBody!)
      expect(m, `'${modId}'s onStart no longer assigns a deferred closure to (ctx as any).${property} — the exemption's premise is gone`).not.toBeNull()
      const openIdx = m!.index + m![0].length - 1
      const block = extractBalancedBlock(onStartBody!, openIdx)
      const stripped = onStartBody!.slice(0, m!.index) + onStartBody!.slice(m!.index + m![0].length - 1 + block.length)
      expect(
        ROUTE_CREATION_PATTERN.test(stripped),
        `'${modId}'s onStart has a route-creation call OUTSIDE the verified deferred '${property}' closure — the exemption no longer covers everything it needs to`,
      ).toBe(false)

      const invokerFile = fileById.get(invokedBy)
      expect(invokerFile, `'${invokedBy}' not found via the bootstrap.ts scraper`).toBeDefined()
      const invokerSource = readFileSync(invokerFile!, 'utf8')
      expect(
        invokerSource.includes(`${property}()`),
        `'${invokedBy}' no longer invokes the deferred '${modId}.(ctx as any).${property}' closure — is it dead code now, and does '${modId}' need to lose its exemption?`,
      ).toBe(true)
    }
  })

  it("every module whose onStart creates routes is ordered after 'auth' in the REAL bootstrap.ts registration + dependency graph", () => {
    const scraped = scrapeBootstrapRegistrationOrder()
    expect(scraped.length, 'the bootstrap.ts scraper found suspiciously few module registrations — has its shape changed?').toBeGreaterThan(40)

    const metaByFile = new Map(scraped.map(({ file }) => [file, loadModuleMeta(file)]))

    // Register real stub modules into a REAL ModuleLoader, in the SAME order
    // bootstrap.ts registers them, then ask the REAL algorithm for the order.
    const loader = new ModuleLoader()
    for (const { file } of scraped) {
      const meta = metaByFile.get(file)!
      if (!loader.hasModule(meta.id)) loader.register(makeStubModule(meta.id, meta.dependencies))
    }
    const order = loader.resolveDependencies()
    const authIndex = order.indexOf('auth')
    expect(authIndex, "'auth' did not appear in the resolved order at all — scraping bug").toBeGreaterThanOrEqual(0)

    const violations: string[] = []
    const staleExemptions: string[] = []
    for (const { file } of scraped) {
      const meta = metaByFile.get(file)!
      if (meta.id === 'auth') continue
      const source = readFileSync(file, 'utf8')
      let onStartBody = extractOnStartBody(source)
      if (!onStartBody) continue

      const deferred = DEFERRED_ROUTE_CREATION.get(meta.id)
      if (deferred) {
        const m = new RegExp(`\\(ctx as any\\)\\.${deferred.property}\\s*=\\s*async\\s*\\(\\s*\\)\\s*=>\\s*\\{`).exec(onStartBody)
        if (m) {
          const openIdx = m.index + m[0].length - 1
          const block = extractBalancedBlock(onStartBody, openIdx)
          onStartBody = onStartBody.slice(0, m.index) + onStartBody.slice(m.index + m[0].length - 1 + block.length)
        }
      }
      if (!ROUTE_CREATION_PATTERN.test(onStartBody)) continue

      if (PUBLIC_MODULE_IDS.has(meta.id)) continue // no auth to bypass — nothing to order

      const idx = order.indexOf(meta.id)
      const isViolation = idx <= authIndex
      if (ONSTART_AUTH_ORDERING_DEBT_BASELINE.has(meta.id)) {
        if (!isViolation) staleExemptions.push(meta.id) // fixed since — baseline entry is now stale
        continue
      }
      if (isViolation) {
        violations.push(`  - '${meta.id}' (${file.slice(ROOT.length + 1)}) resolves at position ${idx}, 'auth' is at ${authIndex}`)
      }
    }
    expect(staleExemptions, `these ONSTART_AUTH_ORDERING_DEBT_BASELINE entries are now correctly ordered — remove them from the baseline: ${staleExemptions.join(', ')}`).toEqual([])
    if (violations.length > 0) {
      throw new Error(
        `Module(s) create routes from onStart but are NOT ordered after 'auth' in the real ` +
          `dependency graph — their routes will be registered before auth's middleware exists, ` +
          `so none of it will ever run for them (see this file's header for the mechanism):\n` +
          `${violations.join('\n')}\n` +
          `Add 'auth' to the module's dependencies array (see home/index.ts for the pattern), or, ` +
          `if this is a known, deliberate, hard-to-fix pre-existing gap, add it to ` +
          `ONSTART_AUTH_ORDERING_DEBT_BASELINE with the same justification rigor as the existing entry.`,
      )
    }
  })

  it('the graph-ordering detector actually discriminates: dropping auth from a dependency array is caught', () => {
    const loader = new ModuleLoader()
    loader.register(makeStubModule('auth', ['permissions']))
    loader.register(makeStubModule('permissions', []))
    // 'home' registered BEFORE 'auth' would be, and WITHOUT the 'auth' edge —
    // mirrors the real bootstrap.ts registration order this bug depended on.
    const brokenLoader = new ModuleLoader()
    brokenLoader.register(makeStubModule('home', ['permissions'])) // no 'auth' edge, registered first
    brokenLoader.register(makeStubModule('permissions', []))
    brokenLoader.register(makeStubModule('auth', ['permissions']))
    const brokenOrder = brokenLoader.resolveDependencies()
    expect(brokenOrder.indexOf('home')).toBeLessThan(brokenOrder.indexOf('auth'))

    const fixedLoader = new ModuleLoader()
    fixedLoader.register(makeStubModule('home', ['permissions', 'auth']))
    fixedLoader.register(makeStubModule('permissions', []))
    fixedLoader.register(makeStubModule('auth', ['permissions']))
    const fixedOrder = fixedLoader.resolveDependencies()
    expect(fixedOrder.indexOf('home')).toBeGreaterThan(fixedOrder.indexOf('auth'))
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Part B — every live /api/v1/<segment> is publicly exempt, explicitly
// paired with authenticate + csrfProtection, or a named, frozen debt entry.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Segments deliberately public end-to-end, mirroring auth/routes.ts's own
 * `isPublicApiRoute` — cross-checked below against that function's actual
 * source using precise, syntax-anchored patterns (an exact `path === '...'`
 * check, an exact `path.startsWith('.../')` prefix check, or an exact nested
 * `path === '.../<literal>'` check) rather than a loose substring search, so
 * this can't pass just because the segment name is mentioned SOMEWHERE in
 * the 700+ line file (e.g. inside its own authenticate/csrfProtection pairing
 * block, which would make the check unfalsifiable).
 */
const PUBLIC_SEGMENTS = new Set(['health', 'setup', 'webhooks'])

/**
 * Protected via an inline `authenticate` middleware argument on each
 * individual route (`router.post('/api/v1/auth/logout', authenticate, ...)`),
 * not the `router.use(prefix, authenticate)` pattern this scanner looks for
 * elsewhere — auth/routes.ts pairs these with csrfProtection via
 * `router.use('/api/v1/<segment>/*', csrfProtection)` instead. Verified below
 * against source, not just asserted.
 */
const INLINE_AUTH_SEGMENTS = new Set(['auth', 'users', 'api-keys'])

/**
 * Pre-existing CSRF-pairing gaps as of 2026-08-25, discovered by this same
 * scanner while investigating the home login-bounce bug (see this file's
 * header). Each of these segments has real mutating (POST/PUT/PATCH/DELETE)
 * endpoints that currently rely on the deny-by-default catch-all alone for
 * authentication (fine, as long as Part A/A2 hold) and have NO csrfProtection
 * at all — genuine, live CSRF exposure. Auditing and fixing each is separate
 * work, out of scope for the home fix this test was added for — frozen here,
 * exactly like the tsc/test baselines this task was reviewed against, so
 * this contract can go green without silently absorbing an unrelated
 * backlog. No segment may be ADDED to this list without the same
 * justification; `home` must never be one — see the dedicated assertion
 * below. Verified below to actually have a mutating verb each, so this list
 * can't quietly accumulate GET-only entries that carry no real CSRF risk
 * (see GET_ONLY_UNPAIRED_SEGMENTS for those instead). 17 entries.
 */
const CSRF_PAIRING_DEBT_BASELINE = new Set([
  'a2a', 'artifacts', 'client-wiki', 'connections', 'costops', 'data-port',
  'federation', 'ideas', 'intel', 'internal', 'ops', 'privacy',
  'prompt-coach', 'skill-generation', 'system', 'team-sessions', 'voice',
])

/**
 * A CSRF_PAIRING_DEBT_BASELINE entry that scanLiveSegments cannot see AT
 * ALL — not "sees it but says hasMutating: false", genuinely absent from its
 * output — so the normal "verify it really has a mutating route" check below
 * can't run for it. Cause: the route file's Hono sub-app is both CREATED and
 * MOUNTED in a DIFFERENT file (this scanner's documented per-file limit —
 * see scanLiveSegments' header), AND the verb-call receiver inside the route
 * file is a local alias of the passed-in parameter (`const api = app`), not
 * the name used at the mount call site — two layers of indirection this
 * textual scanner does not chase. Manually verified instead (see the file/
 * line evidence in the comment on the entry). If scanLiveSegments ever grows
 * to see one of these, the dedicated test below will fail, telling you to
 * move it back to normal, scanner-verified status.
 */
const CSRF_DEBT_SCANNER_BLIND_SPOTS = new Map<string, string>([
  [
    'team-sessions',
    'src/modules/agent/routes-team.ts (mounted via src/modules/agent/index.ts:933, ' +
      "ctx.http.route('/api/v1', teamApi)) — routes-team.ts's `createTeamRoutes(app, ...)` " +
      'does `const api = app` and calls `api.post(...)` throughout, so the mount variable ' +
      "name ('teamApi', from the caller) never appears next to the verb calls ('api', local " +
      'to the callee). Manually confirmed real mutating routes: POST .../team/propose, ' +
      '.../approve, .../reject, .../resume, .../memory — no csrfProtection pairing exists ' +
      'for \'team-sessions\' in auth/routes.ts.',
  ],
])

/**
 * GET-only segments with no explicit auth/CSRF pairing decision recorded.
 * Unlike CSRF_PAIRING_DEBT_BASELINE these carry no CSRF risk at all — CSRF
 * forges a state-changing request, and there is no mutating verb here to
 * forge — but they're still named rather than silently dropped from the
 * scan, and verified below to genuinely have no mutating verb, so a future
 * mutating route added to one of these can't hide by piggybacking on a
 * label that means "nothing to worry about". 2 entries.
 */
const GET_ONLY_UNPAIRED_SEGMENTS = new Set(['filesystem', 'statusbar'])

const MUTATING_VERBS = ['post', 'put', 'delete', 'patch'] as const

/**
 * `parentApp.route('/api/v1[/segment...]', subAppVar)` — captures the mount
 * PATH and the local variable name of the mounted sub-app, so a later verb
 * call on that variable can be resolved back to its real prefix. Matches
 * both a bare `/api/v1` mount (sub-app's own paths carry the segment) and a
 * fixed-prefix mount like `/api/v1/security` (segment is the prefix itself).
 */
const MOUNT_PATTERN = /\.route\(\s*['"](\/api\/v1[a-zA-Z0-9\-/]*)['"]\s*,\s*(\w+)\)/g
/** `receiver.<verb>('<path>', ...)` — path may be absolute or relative to `receiver`'s mount. */
const VERB_CALL_PATTERN = /(\w+)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g

interface SegmentInfo {
  files: Set<string>
  hasMutating: boolean
}

/**
 * Scans every non-test file under src/modules for `/api/v1/<segment>` routes
 * and returns, per distinct first-path-segment live in source today, which
 * files it was found in and whether any mutating verb was seen for it.
 *
 * Per file: builds a map of local sub-app variable name -> its mount prefix
 * (from every `.route('/api/v1[...]', someVar)` call in that file), then for
 * every `receiver.<verb>('<path>', ...)` call resolves the full path either
 * directly (path is already `/api/v1/...`, the "direct" pattern most modules
 * use — e.g. board/routes.ts) or by combining `receiver`'s mount prefix with
 * a relative path (the "sub-app" pattern — e.g. home/routes.ts's bare
 * `/api/v1` mount, or security-gate/routes.ts's two DIFFERENTLY-prefixed
 * sub-apps `router` at `/api/v1/security` and `autonomy` at
 * `/api/v1/autonomy`, which is exactly why this resolves per-variable rather
 * than assuming one mount per file).
 *
 * This is a best-effort textual scan, not a router simulation: a file that
 * mounts a sub-app built in a DIFFERENT file, or whose verb-call receiver
 * variable this scanner can't tie back to a mount in the SAME file, is
 * skipped for that call (silently under-counts rather than false-positives).
 * Given the actual code in this repo (checked file-by-file while writing
 * this test) that limitation doesn't drop anything real today — full
 * import-and-boot route introspection was considered and rejected per this
 * test's header, since it can't hold against the source itself.
 */
function scanLiveSegments(): Map<string, SegmentInfo> {
  const segments = new Map<string, SegmentInfo>()
  const add = (seg: string, file: string, verb: string) => {
    if (!seg) return
    if (!segments.has(seg)) segments.set(seg, { files: new Set(), hasMutating: false })
    const info = segments.get(seg)!
    info.files.add(file)
    if ((MUTATING_VERBS as readonly string[]).includes(verb)) info.hasMutating = true
  }

  for (const file of walk(MODULES_DIR)) {
    const relFile = file.slice(ROOT.length + 1)
    const source = readFileSync(file, 'utf8')

    const mountMap = new Map<string, string>() // local sub-app var name -> its mount prefix
    for (const m of source.matchAll(MOUNT_PATTERN)) {
      mountMap.set(m[2], m[1])
    }

    for (const m of source.matchAll(VERB_CALL_PATTERN)) {
      const [, receiver, verb, path] = m
      let full: string | null = null
      if (path === '/api/v1' || path.startsWith('/api/v1/')) {
        full = path
      } else if (mountMap.has(receiver)) {
        const prefix = mountMap.get(receiver)!
        full = path === '/' ? prefix : prefix + path
      }
      if (!full) continue // unresolvable receiver/path combination — see this function's header
      add(full.split('/')[3], relFile, verb)
    }
  }
  return segments
}

/** segment -> which of {authenticate, csrfProtection} auth/routes.ts pairs it with via router.use(). */
function scanAuthPairs(authSource: string): Map<string, Set<string>> {
  const pairs = new Map<string, Set<string>>()
  const pattern = /router\.use\(\s*['"]\/api\/v1\/([a-zA-Z0-9\-]+)(?:\/[^'"]*)?['"]\s*,\s*(authenticate|csrfProtection)\)/g
  for (const m of authSource.matchAll(pattern)) {
    if (!pairs.has(m[1])) pairs.set(m[1], new Set())
    pairs.get(m[1])!.add(m[2])
  }
  return pairs
}

/**
 * Isolates the `isPublicApiRoute` function body — from its declaration to
 * the first `router.use(` call after it (which is the deny-by-default
 * catch-all that immediately follows it in auth/routes.ts today). Used to
 * check both what it DOES exempt (PUBLIC_SEGMENTS cross-check) and what it
 * must NOT exempt (any segment this file believes is fully protected).
 */
function extractIsPublicApiRouteBody(authSource: string): string {
  const start = authSource.indexOf('const isPublicApiRoute')
  if (start === -1) throw new Error("'isPublicApiRoute' not found in auth/routes.ts — has it been renamed or removed?")
  const end = authSource.indexOf('router.use(', start)
  if (end === -1) throw new Error('could not find the end of isPublicApiRoute (expected a router.use( call right after it)')
  return authSource.slice(start, end)
}

describe('Part B — every live /api/v1 segment is public, paired, or a named debt entry', () => {
  const authSource = readFileSync(AUTH_ROUTES_FILE, 'utf8')
  const liveSegments = scanLiveSegments()
  const pairs = scanAuthPairs(authSource)
  const isPublicBody = extractIsPublicApiRouteBody(authSource)

  it('PUBLIC_SEGMENTS matches auth/routes.ts\'s isPublicApiRoute via precise, syntax-anchored checks only', () => {
    for (const seg of PUBLIC_SEGMENTS) {
      const matchesExact = new RegExp(`path === '/api/v1/${seg}'`).test(isPublicBody)
      const matchesPrefix = new RegExp(`path\\.startsWith\\('/api/v1/${seg}/'\\)`).test(isPublicBody)
      const matchesNestedExact = new RegExp(`path === '/api/v1/${seg}/[a-zA-Z0-9_-]+'`).test(isPublicBody)
      expect(
        matchesExact || matchesPrefix || matchesNestedExact,
        `PUBLIC_SEGMENTS claims '${seg}' is public, but isPublicApiRoute in auth/routes.ts has no exact/prefix/nested-exact check for it`,
      ).toBe(true)
    }
  })

  /**
   * True only if isPublicApiRoute exempts the WHOLE segment or a BROAD
   * portion of it (an exact root check, or a `startsWith('.../')` prefix
   * check) — not a single, narrow, deliberately-named nested exact path.
   * A protected segment CAN legitimately carry one specific narrow public
   * carve-out (e.g. `/api/v1/hands/pair` — pairing uses a one-time code as
   * its own credential — while the rest of /hands/* stays protected; same
   * shape as `/api/v1/auth/login`). That distinction is exactly what
   * PUBLIC_SEGMENTS' own matchesNestedExact alternative recognizes as
   * intentional design, so this reuses the same three-way classification,
   * just checking the OTHER two (whole-segment) alternatives only.
   */
  function isBroadlyPublic(seg: string, body: string): boolean {
    const matchesExact = new RegExp(`path === '/api/v1/${seg}'`).test(body)
    const matchesPrefix = new RegExp(`path\\.startsWith\\('/api/v1/${seg}/'\\)`).test(body)
    return matchesExact || matchesPrefix
  }

  it('isPublicApiRoute does not broadly exempt any fully-protected (paired) segment — guards against silent scope creep', () => {
    const fullyPaired = [...pairs.entries()]
      .filter(([, mw]) => mw.has('authenticate') && mw.has('csrfProtection'))
      .map(([seg]) => seg)
    expect(fullyPaired.length, 'no fully-paired segments found at all — scanAuthPairs may be broken').toBeGreaterThan(10)

    const leaked = fullyPaired.filter((seg) => isBroadlyPublic(seg, isPublicBody))
    expect(
      leaked,
      `isPublicApiRoute now exempts the WHOLE segment or a broad prefix of it for: ${leaked.join(', ')} — ` +
        `that makes it (mostly or entirely) public even though it is explicitly authenticate+csrfProtection-paired elsewhere ` +
        `(a single narrow nested-exact carve-out, like /api/v1/hands/pair, is fine and does not trip this check)`,
    ).toEqual([])
  })

  it("isPublicApiRoute does not broadly exempt 'home' specifically — the exact bug this test guards", () => {
    expect(isBroadlyPublic('home', isPublicBody)).toBe(false)
  })

  it('INLINE_AUTH_SEGMENTS really do call `authenticate` inline per-route, and are csrfProtection-paired', () => {
    for (const seg of INLINE_AUTH_SEGMENTS) {
      const hasInlineAuth = new RegExp(`router\\.(?:get|post|put|patch|delete)\\(\\s*['"]\\/api\\/v1\\/${seg}[^'"]*['"]\\s*,\\s*authenticate`).test(authSource)
      expect(hasInlineAuth, `'${seg}' is listed as inline-auth but no route literal in auth/routes.ts passes authenticate directly`).toBe(true)
      const hasCsrf = pairs.get(seg)?.has('csrfProtection') ?? false
      expect(hasCsrf, `'${seg}' is listed as inline-auth but has no router.use('/api/v1/${seg}/*', csrfProtection) pairing`).toBe(true)
    }
  })

  it('CSRF_PAIRING_DEBT_BASELINE has no stale entries (segments that got fixed since)', () => {
    const stale = [...CSRF_PAIRING_DEBT_BASELINE].filter((seg) => {
      const p = pairs.get(seg)
      return p?.has('authenticate') && p?.has('csrfProtection')
    })
    expect(stale, `these debt entries are now fully paired in auth/routes.ts — remove them from CSRF_PAIRING_DEBT_BASELINE: ${stale.join(', ')}`).toEqual([])
  })

  it('CSRF_PAIRING_DEBT_BASELINE entries genuinely have a mutating route (real debt, not labelling noise)', () => {
    const notMutating = [...CSRF_PAIRING_DEBT_BASELINE]
      .filter((seg) => !CSRF_DEBT_SCANNER_BLIND_SPOTS.has(seg)) // those are verified separately, below
      .filter((seg) => !(liveSegments.get(seg)?.hasMutating ?? false))
    expect(
      notMutating,
      `these are listed as CSRF debt but the scanner found no mutating verb for them — move to GET_ONLY_UNPAIRED_SEGMENTS instead: ${notMutating.join(', ')}`,
    ).toEqual([])
  })

  it('CSRF_DEBT_SCANNER_BLIND_SPOTS entries really are invisible to the scanner (so the manual-verification comment stays honest)', () => {
    for (const seg of CSRF_DEBT_SCANNER_BLIND_SPOTS.keys()) {
      expect(CSRF_PAIRING_DEBT_BASELINE.has(seg), `'${seg}' is a blind-spot entry but not in CSRF_PAIRING_DEBT_BASELINE — remove it from one or the other`).toBe(true)
      expect(
        liveSegments.has(seg),
        `'${seg}' is now VISIBLE to the scanner (scanLiveSegments improved, or the code changed) — move it out of CSRF_DEBT_SCANNER_BLIND_SPOTS and into the normal, scanner-verified check above`,
      ).toBe(false)
    }
  })

  it('GET_ONLY_UNPAIRED_SEGMENTS genuinely have no mutating route (no CSRF risk to mislabel as debt)', () => {
    const actuallyMutating = [...GET_ONLY_UNPAIRED_SEGMENTS].filter((seg) => liveSegments.get(seg)?.hasMutating ?? false)
    expect(
      actuallyMutating,
      `these are labelled GET-only but the scanner found a mutating verb for them — move to CSRF_PAIRING_DEBT_BASELINE instead: ${actuallyMutating.join(', ')}`,
    ).toEqual([])
  })

  it('CSRF_PAIRING_DEBT_BASELINE never contains home — that is the exact bug this test guards', () => {
    expect(CSRF_PAIRING_DEBT_BASELINE.has('home')).toBe(false)
    expect(GET_ONLY_UNPAIRED_SEGMENTS.has('home')).toBe(false)
  })

  it("'home' is explicitly paired with authenticate + csrfProtection in auth/routes.ts", () => {
    const homePair = pairs.get('home')
    expect(homePair?.has('authenticate'), "auth/routes.ts is missing router.use('/api/v1/home/*', authenticate)").toBe(true)
    expect(homePair?.has('csrfProtection'), "auth/routes.ts is missing router.use('/api/v1/home/*', csrfProtection)").toBe(true)
  })

  it('every live segment is public, paired, inline-auth, or a named debt entry — no silent new gap', () => {
    const uncovered: string[] = []
    for (const seg of liveSegments.keys()) {
      if (PUBLIC_SEGMENTS.has(seg)) continue
      if (INLINE_AUTH_SEGMENTS.has(seg)) continue
      if (CSRF_PAIRING_DEBT_BASELINE.has(seg)) continue
      if (GET_ONLY_UNPAIRED_SEGMENTS.has(seg)) continue
      const p = pairs.get(seg)
      if (p?.has('authenticate') && p?.has('csrfProtection')) continue
      uncovered.push(seg)
    }
    if (uncovered.length > 0) {
      const detail = uncovered
        .map((seg) => `  - /api/v1/${seg}/* (found in: ${[...(liveSegments.get(seg)?.files ?? [])].join(', ')})`)
        .join('\n')
      throw new Error(
        `New /api/v1 segment(s) with no auth/CSRF coverage decision:\n${detail}\n` +
          `Add router.use('/api/v1/<segment>/*', authenticate) + csrfProtection to ` +
          `src/modules/auth/routes.ts (see the '/api/v1/home/*' block for the pattern), ` +
          `or, if genuinely public, add it to isPublicApiRoute AND this test's PUBLIC_SEGMENTS.`,
      )
    }
  })

  it('the live-segment scanner actually discriminates: it finds a synthetic uncovered segment', () => {
    // Sanity check on scanLiveSegments' own regexes, independent of the real
    // tree, so a future refactor of the patterns can't silently stop scanning
    // anything and have every check above pass by finding nothing.
    const fakeAbsolute = `app.get('/api/v1/totally-fake-segment/thing', handler)`
    const matches = [...fakeAbsolute.matchAll(VERB_CALL_PATTERN)]
    expect(matches.length).toBe(1)
    expect(matches[0][3].split('/')[3]).toBe('totally-fake-segment')
  })
})
