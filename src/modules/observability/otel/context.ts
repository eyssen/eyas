// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span, SpanContext, TraceId, SpanId } from './types.js'

/**
 * W3C Trace Context header parsing / formatting.
 * Spec: https://www.w3.org/TR/trace-context/
 *
 * Format: version-trace_id-parent_id-trace_flags
 * Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 */
const TRACEPARENT_RE =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export function parseTraceparent(header: string | null | undefined): SpanContext | null {
  if (!header) return null
  const trimmed = header.trim().toLowerCase()
  const m = TRACEPARENT_RE.exec(trimmed)
  if (!m) return null
  const [, version, traceId, spanId, flags] = m
  // Per spec: version 'ff' is invalid; all-zero ids are invalid.
  if (version === 'ff') return null
  if (traceId === '0'.repeat(32)) return null
  if (spanId === '0'.repeat(16)) return null
  return {
    traceId: traceId as TraceId,
    spanId: spanId as SpanId,
    traceFlags: parseInt(flags, 16),
    isRemote: true,
  }
}

export function formatTraceparent(ctx: SpanContext): string {
  const flags = ctx.traceFlags.toString(16).padStart(2, '0')
  return `00-${ctx.traceId}-${ctx.spanId}-${flags}`
}

/**
 * AsyncLocalStorage-based active span propagation. This allows downstream
 * code in the same async task to discover the parent span without explicit
 * plumbing, which is the standard OTel pattern.
 */
const als = new AsyncLocalStorage<Span>()

export function getActiveSpan(): Span | undefined {
  return als.getStore()
}

export function withActiveSpan<T>(span: Span, fn: () => T): T {
  return als.run(span, fn)
}

export async function withActiveSpanAsync<T>(
  span: Span,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(span, fn)
}

/**
 * Cryptographically-random IDs using crypto.getRandomValues (Bun/Node 20+).
 */
export function generateTraceId(): TraceId {
  return randomHex(16) as TraceId
}

export function generateSpanId(): SpanId {
  return randomHex(8) as SpanId
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  const g = globalThis as unknown as { crypto?: Crypto }
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (let i = 0; i < bytes; i++) out += buf[i]!.toString(16).padStart(2, '0')
  return out
}
