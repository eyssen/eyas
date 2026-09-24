// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The keys of the EYAS memory plugin inside OpenCode, and the per-session
// proofs made with them.
//
// Key. Every OpenCode process EYAS starts gets its own 32-byte key: one per
// `opencode serve` start (opencode-runner.ts) and one per OpenCode terminal
// (pty-manager.ts). A key lives exactly as long as its process and is revoked
// when that process exits or restarts. It is never put into an environment,
// an argument list or a file: EYAS writes it into the child's fd 3 — a socket
// only that process holds — and ends it (deliverPluginKey). The plugin reads
// it once while OpenCode loads it, before any session can run a shell, keeps
// it in memory and closes fd 3 (plugin-source.ts). No shell the model runs,
// and no reader of the process's environment (`ps eww`,
// /proc/<pid>/environ), sees it. OpenCode 1.18.29 keeps an inherited fd 3
// open for its in-process plugins and closes nothing the plugin needs (the
// live lane's OpenCode case proves it on the real binary).
//
// Proof. The key never leaves the plugin. Each memory call carries a proof
// for ONE session: HMAC-SHA256 over the id of the OpenCode session the tool
// runs in (the tool context's `sessionID`, set by OpenCode, never by the
// model), a fresh nonce and the time. EYAS accepts a proof only while its key
// lives, only within SESSION_PROOF_MAX_AGE_MS of the time it names, and only
// once; the session it names is the only session the call may act for. A
// call for another session needs that session's proof, and that needs the
// key. WHAT a proven session may read is still decided from its server-side
// binding (memory-bridge.ts).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Writable } from 'node:stream'
import { z } from 'zod'
import { generateId } from '@shared/crypto.js'
import type { PluginTokenOwnerKind } from './types.js'

/** The child file descriptor EYAS writes a process's key into. */
export const OPENCODE_KEY_FD = 3
/**
 * Set to "3" only in an OpenCode process EYAS hands a key on fd 3: the plugin
 * reads fd 3 only then (another descriptor 3 is never touched).
 */
export const OPENCODE_KEY_FD_ENV = 'EYAS_OPENCODE_KEY_FD'
/** Spawn stdio of an `opencode serve` EYAS starts: fd 3 is the key socket. */
export const OPENCODE_SERVE_STDIO = Object.freeze(['ignore', 'pipe', 'pipe', 'pipe'] as const)

/** Prefix of a session-proof bearer: never an EYAS API key (eyas_k1_…) or a JWT. */
export const SESSION_PROOF_PREFIX = 'eyas-ocs.'
/** Domain separation of the proof MAC (the plugin uses the same label). */
export const SESSION_PROOF_LABEL = 'eyas-opencode-memory-call/v1'
/** How far from EYAS's clock a proof's time may be (the plugin runs on the same host). */
export const SESSION_PROOF_MAX_AGE_MS = 2 * 60_000

/** Random bytes per key. */
const KEY_BYTES = 32
/** HMAC-SHA256 output. */
const MAC_BYTES = 32
/** Longest encoded payload EYAS parses (a 200-char session id fits with room). */
const MAX_PAYLOAD_CHARS = 1_024
const BASE64URL = /^[A-Za-z0-9_-]+$/

/** The signed part of a proof: session id, nonce, time (ms). The plugin sends exactly these. */
const ProofPayloadSchema = z.object({
  s: z.string().min(1).max(200),
  n: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  t: z.number().int().nonnegative(),
}).strict()

export interface MintedPluginKey {
  /** The handle EYAS keeps (bindings, revocation); never the secret itself. */
  tokenId: string
  /** The key handed to exactly one OpenCode process, on its fd 3. */
  key: string
}

/** A verified plugin call: the process key it was made with and the one session it speaks for. */
export interface ProvenPluginCall {
  tokenId: string
  sessionId: string
}

export interface PluginTokenRegistry {
  mint(ownerKind: PluginTokenOwnerKind, ownerId: string): MintedPluginKey
  /** Idempotent: an unknown or already revoked id is ignored. */
  revoke(tokenId: string): void
  /**
   * The call a live, fresh, unused proof stands for, else null — without
   * using it up (the auth middleware). Constant time over the live keys.
   */
  check(bearer: string | null | undefined): ProvenPluginCall | null
  /** check(), and the proof is used up: it works for one call (the route). */
  redeem(bearer: string | null | undefined): ProvenPluginCall | null
  /** Live keys (diagnostics and tests). */
  size(): number
}

/** Whether a bearer has the form of a session proof (says nothing about its validity). */
export function isSessionProof(bearer: unknown): bearer is string {
  return typeof bearer === 'string' && bearer.startsWith(SESSION_PROOF_PREFIX)
}

function macOf(key: string, payload: string): Buffer {
  return createHmac('sha256', key).update(`${SESSION_PROOF_LABEL}.${payload}`).digest()
}

/**
 * A proof exactly as the plugin makes it (plugin-source.ts mirrors this in
 * the OpenCode process; a test runs the generated plugin against it).
 */
export function makeSessionProof(key: string, sessionId: string, opts: { nonce?: string; issuedAtMs?: number } = {}): string {
  const body = { s: sessionId, n: opts.nonce ?? randomBytes(18).toString('base64url'), t: opts.issuedAtMs ?? Date.now() }
  const payload = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
  return `${SESSION_PROOF_PREFIX}${payload}.${macOf(key, payload).toString('base64url')}`
}

interface ParsedProof {
  payload: string
  mac: Buffer
  sessionId: string
  nonce: string
  issuedAtMs: number
}

function parseProof(bearer: unknown): ParsedProof | null {
  if (!isSessionProof(bearer)) return null
  const rest = bearer.slice(SESSION_PROOF_PREFIX.length)
  const dot = rest.indexOf('.')
  if (dot <= 0 || dot !== rest.lastIndexOf('.')) return null
  const payload = rest.slice(0, dot)
  const macText = rest.slice(dot + 1)
  if (payload.length > MAX_PAYLOAD_CHARS || !BASE64URL.test(payload) || !BASE64URL.test(macText)) return null
  const mac = Buffer.from(macText, 'base64url')
  if (mac.length !== MAC_BYTES || mac.toString('base64url') !== macText) return null
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const parsed = ProofPayloadSchema.safeParse(decoded)
  if (!parsed.success) return null
  return { payload, mac, sessionId: parsed.data.s, nonce: parsed.data.n, issuedAtMs: parsed.data.t }
}

interface LiveKey {
  secret: string
  ownerKind: PluginTokenOwnerKind
  ownerId: string
  /** Nonces of redeemed proofs → when they could no longer be fresh anyway. */
  used: Map<string, number>
}

export function createPluginTokenRegistry(opts: { now?: () => number } = {}): PluginTokenRegistry {
  const now = opts.now ?? Date.now
  const live = new Map<string, LiveKey>()

  function match(bearer: unknown): { tokenId: string; entry: LiveKey; proof: ParsedProof } | null {
    const proof = parseProof(bearer)
    if (!proof) return null
    if (Math.abs(now() - proof.issuedAtMs) > SESSION_PROOF_MAX_AGE_MS) return null
    let found: { tokenId: string; entry: LiveKey } | null = null
    // Every live key is tried, whichever matches: the time taken says nothing
    // about which key (or how much of a MAC) was right.
    for (const [tokenId, entry] of live) {
      if (timingSafeEqual(macOf(entry.secret, proof.payload), proof.mac) && found === null) found = { tokenId, entry }
    }
    if (!found || found.entry.used.has(proof.nonce)) return null
    return { ...found, proof }
  }

  return {
    mint(ownerKind, ownerId) {
      const key = randomBytes(KEY_BYTES).toString('base64url')
      const tokenId = generateId()
      live.set(tokenId, { secret: key, ownerKind, ownerId, used: new Map() })
      return { tokenId, key }
    },

    revoke(tokenId) {
      live.delete(tokenId)
    },

    check(bearer) {
      const m = match(bearer)
      return m ? { tokenId: m.tokenId, sessionId: m.proof.sessionId } : null
    },

    redeem(bearer) {
      const m = match(bearer)
      if (!m) return null
      const t = now()
      for (const [nonce, expiresAt] of m.entry.used) {
        if (expiresAt < t) m.entry.used.delete(nonce)
      }
      m.entry.used.set(m.proof.nonce, m.proof.issuedAtMs + SESSION_PROOF_MAX_AGE_MS)
      return { tokenId: m.tokenId, sessionId: m.proof.sessionId }
    },

    size() {
      return live.size
    },
  }
}

/**
 * Hand `key` to a just-spawned OpenCode process: write it into the child's
 * fd 3 (spawned with a 'pipe' there) and end it. False when the child has no
 * such pipe — then it gets no key and no EYAS memory. A child that exits
 * before reading it is not an EYAS error (its key dies with it).
 */
export function deliverPluginKey(child: { stdio?: ReadonlyArray<unknown> | null }, key: string): boolean {
  const pipe = child.stdio?.[OPENCODE_KEY_FD] as Writable | null | undefined
  if (!pipe || typeof pipe.end !== 'function') return false
  pipe.on?.('error', () => undefined)
  pipe.end(key)
  return true
}
