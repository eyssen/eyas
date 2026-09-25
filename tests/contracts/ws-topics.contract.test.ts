// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { WS_TOPIC_KEYS, WS_SUBSCRIBE_DENIED_EVENT, type WsTopicKey } from '@shared/ws-topics'

/**
 * WebSocket topic contract — an fs-scan guard (same shape as
 * tests/core/i18n-parity.test.ts) over the whole `src` tree.
 *
 * Two failure modes this closes, both of which used to be invisible until a
 * user reported "the page just doesn't update":
 *
 *  1. A hand-written topic string. Producer and consumer each spelled the
 *     topic themselves, so a rename on one side stranded the other silently.
 *     Every subscribe/broadcast call site must take its topic from the shared
 *     WS_TOPICS catalogue instead of an inline literal.
 *  2. A one-sided topic. A backend broadcast nobody subscribes to (dead
 *     transport) or a frontend subscription nothing ever broadcasts to (dead
 *     page) both type-check perfectly. Every catalogue key must therefore have
 *     at least one backend producer AND at least one frontend consumer.
 *
 * Deliberately textual rather than AST-based: it has to hold for .ts and .tsx,
 * for backend and frontend, and it must fail on the *source* a reviewer reads.
 */

const ROOT = process.cwd()
const SRC_DIR = join(ROOT, 'src')
const WEB_SRC_PREFIX = join('src', 'web', 'src') + sep
const WEB_PREFIX = join('src', 'web') + sep

/** Generated, vendored or non-source trees — never part of the contract. */
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'build', 'coverage', 'locales', '.gen', 'gen'])

/** The catalogue itself and its thin web re-export define the keys; they don't use them. */
const CATALOGUE_FILES = new Set([join('src', 'shared', 'ws-topics.ts'), join('src', 'web', 'src', 'lib', 'ws-topics.ts')])

/**
 * Topics that are legitimately one-sided, each with the reason. EMPTY is the
 * target state: an entry here is a documented gap, not a free pass, and the
 * test below also fails on a *stale* entry (one whose topic has since grown
 * its missing side) so justifications can't outlive the problem.
 */
const ONE_SIDED: Partial<Record<WsTopicKey, string>> = {}

interface SourceFile {
  /** Path relative to the repo root, with platform separators. */
  path: string
  /** Comment-free source — a topic named only in prose proves nothing. */
  code: string
  side: 'backend' | 'web'
}

/**
 * Drop comments before pattern matching so a doc example (`subscribe('board:1',
 * …)` in a JSDoc block) isn't reported as a real call site. Deliberately crude:
 * the worst a mis-stripped string literal can do is hide a match, never invent
 * one.
 */
function stripComments(text: string): string {
  return text
    // Blank out block comments in place — keeping their newlines so the line
    // numbers this test reports still point at the real source.
    .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function collectSources(dir: string, out: SourceFile[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue
      collectSources(full, out)
      continue
    }
    if (!entry.isFile()) continue
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) continue

    const rel = relative(ROOT, full)
    // Everything under src/web that is not src/web/src (vite/tailwind config,
    // scripts) belongs to neither side of the contract.
    const isWeb = rel.startsWith(WEB_SRC_PREFIX)
    if (!isWeb && rel.startsWith(WEB_PREFIX)) continue

    out.push({ path: rel, code: stripComments(readFileSync(full, 'utf-8')), side: isWeb ? 'web' : 'backend' })
  }
}

const SOURCES: SourceFile[] = []
collectSources(SRC_DIR, SOURCES)

/**
 * A `subscribe(` / `broadcast(` call whose first argument opens with a quote or
 * backtick. The lookbehind rejects `unsubscribe(` without consuming the
 * preceding character, so `match.index` points at the keyword itself; a
 * *declaration* (`broadcast(topic: string, …)`) never has a quote there.
 *
 * Matched against the whole file, NOT line by line: `\s` spans newlines, so a
 * prettier-wrapped call (`subscribe(\n  'system',`) is caught too.
 */
const LITERAL_TOPIC_CALL = /(?<![A-Za-z0-9_$])(?:subscribe|broadcast)\s*\(\s*['"`]/g

function hasLiteralTopicCall(source: string): boolean {
  return [...source.matchAll(LITERAL_TOPIC_CALL)].length > 0
}

function literalCallSites(file: SourceFile): string[] {
  const lines = file.code.split('\n')
  return [...file.code.matchAll(LITERAL_TOPIC_CALL)].map(match => {
    const lineIndex = countNewlines(file.code, match.index ?? 0)
    // A wrapped call is reported at its opening line, which is where the fix goes.
    return `${file.path}:${lineIndex + 1}: ${lines[lineIndex]?.trim() ?? ''}`
  })
}

function countNewlines(text: string, upTo: number): number {
  let count = 0
  for (let i = 0; i < upTo; i++) if (text[i] === '\n') count++
  return count
}

/** `WS_TOPICS.agent` must not also match `WS_TOPICS.agentRuns` — hence the boundary. */
function usesTopic(file: SourceFile, key: WsTopicKey): boolean {
  return new RegExp(`WS_TOPICS\\.${key}\\b`).test(file.code)
}

describe('ws-topics contract', () => {
  it('scans a non-trivial source tree (guards against a silently empty scan)', () => {
    expect(SOURCES.filter(f => f.side === 'backend').length).toBeGreaterThan(50)
    expect(SOURCES.filter(f => f.side === 'web').length).toBeGreaterThan(50)
    expect(SOURCES.some(f => f.path === join('src', 'core', 'http', 'ws-bridge.ts'))).toBe(true)
  })

  it('the literal detector bites (and spares the lookalikes)', () => {
    // A scan whose pattern quietly matches nothing would pass forever.
    expect(hasLiteralTopicCall("subscribe('system', cb)")).toBe(true)
    expect(hasLiteralTopicCall('subscribe(`chat:${id}`, cb)')).toBe(true)
    expect(hasLiteralTopicCall("registry.broadcast('autonomy', frame)")).toBe(true)
    expect(hasLiteralTopicCall('ws.broadcast(`board:${projectId}`, frame)')).toBe(true)
    // Formatter-wrapped calls must not slip through: the scan is whole-file,
    // not line-scoped, precisely so these are caught.
    expect(hasLiteralTopicCall("subscribe(\n  'system',\n  cb,\n)")).toBe(true)
    expect(hasLiteralTopicCall('registry.broadcast(\n  `board:${id}`,\n  frame,\n)')).toBe(true)
    expect(hasLiteralTopicCall("return subscribe(\n\t'autonomy', cb)")).toBe(true)

    expect(hasLiteralTopicCall('subscribe(WS_TOPICS.system, cb)')).toBe(false)
    expect(hasLiteralTopicCall('subscribe(\n  WS_TOPICS.system,\n  cb,\n)')).toBe(false)
    expect(hasLiteralTopicCall('registry.broadcast(topic, message)')).toBe(false)
    expect(hasLiteralTopicCall("unsubscribe('system')")).toBe(false)
    expect(hasLiteralTopicCall('broadcast(topic: string, message: unknown): void')).toBe(false)
  })

  it('reports a wrapped offender at its opening line', () => {
    const file: SourceFile = {
      path: 'fake.ts',
      code: ['const a = 1', 'subscribe(', "  'system',", '  cb,', ')'].join('\n'),
      side: 'web',
    }
    expect(literalCallSites(file)).toEqual(['fake.ts:2: subscribe('])
  })

  it('no subscribe/broadcast call site passes an inline topic literal', () => {
    const offenders = SOURCES.flatMap(literalCallSites)
    expect(
      offenders,
      'topics must come from WS_TOPICS (backend: @shared/ws-topics.js, web: @/lib/ws-topics)',
    ).toEqual([])
  })

  describe('the subscribe-denied NACK constant has both sides wired', () => {
    it('has a backend producer (registry) and a frontend consumer (WS hook)', () => {
      const users = SOURCES.filter(f => !CATALOGUE_FILES.has(f.path) && /WS_SUBSCRIBE_DENIED_EVENT\b/.test(f.code))
      const producers = users.filter(f => f.side === 'backend').map(f => f.path)
      const consumers = users.filter(f => f.side === 'web').map(f => f.path)

      expect(producers, 'no backend producer sends WS_SUBSCRIBE_DENIED_EVENT').not.toEqual([])
      expect(consumers, 'no frontend consumer handles WS_SUBSCRIBE_DENIED_EVENT').not.toEqual([])
    })
  })

  describe('every catalogue topic has both sides wired', () => {
    for (const key of WS_TOPIC_KEYS) {
      it(`'${key}' has a backend producer and a frontend consumer`, () => {
        const users = SOURCES.filter(f => !CATALOGUE_FILES.has(f.path) && usesTopic(f, key))
        // `board` counts the bus→WS bridge as its producer: the board module
        // emits nothing itself today, so the bridge's eyas.board.* mapping is
        // the only thing that can reach the topic. Task 8 adds real emits.
        const producers = users.filter(f => f.side === 'backend').map(f => f.path)
        const consumers = users.filter(f => f.side === 'web').map(f => f.path)

        const justification = ONE_SIDED[key]
        if (justification) {
          expect(
            producers.length === 0 || consumers.length === 0,
            `'${key}' is justified in ONE_SIDED ("${justification}") but is now wired on both sides — remove the entry`,
          ).toBe(true)
          return
        }

        expect(producers, `no backend producer broadcasts WS_TOPICS.${key}`).not.toEqual([])
        expect(consumers, `no frontend consumer subscribes to WS_TOPICS.${key}`).not.toEqual([])
      })
    }
  })
})
