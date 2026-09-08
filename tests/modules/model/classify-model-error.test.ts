// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE taxonomy decides whether the gateway may retry a failed provider call.
// Getting it wrong is expensive in both directions: retrying a 401 or a
// caller-abort burns budget on a call that can never succeed, while treating a
// 429/529/timeout as terminal fails a run that a single retry would have saved
// (D9). Retryable is exactly {rate-limit, overload, timeout, network}.

import { describe, it, expect } from 'vitest'
import { classifyModelError, ProviderRunError } from '@shared/classify-model-error.js'

describe('classifyModelError', () => {
  it('classifies rate-limit (429) as retryable', () => {
    expect(classifyModelError({ status: 429 })).toMatchObject({ kind: 'rate-limit', retryable: true })
    expect(classifyModelError(new Error('rate limit exceeded'))).toMatchObject({ kind: 'rate-limit', retryable: true })
  })

  it('classifies overload (529) as retryable', () => {
    expect(classifyModelError({ status: 529 })).toMatchObject({ kind: 'overload', retryable: true })
    expect(classifyModelError(new Error('Overloaded'))).toMatchObject({ kind: 'overload', retryable: true })
  })

  it('classifies auth (401/403) as terminal', () => {
    expect(classifyModelError({ status: 401 })).toMatchObject({ kind: 'auth', retryable: false })
    expect(classifyModelError({ status: 403 })).toMatchObject({ kind: 'auth', retryable: false })
    expect(classifyModelError(new Error('invalid api key'))).toMatchObject({ kind: 'auth', retryable: false })
  })

  it('classifies a caller abort as terminal', () => {
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    expect(classifyModelError(abort)).toMatchObject({ kind: 'aborted', retryable: false })
    expect(classifyModelError({ name: 'AbortError', message: 'aborted' })).toMatchObject({ kind: 'aborted', retryable: false })
  })

  it('classifies timeouts as retryable, including a timeout wearing an abort name', () => {
    expect(classifyModelError(new Error('connect ETIMEDOUT 1.2.3.4:443'))).toMatchObject({ kind: 'timeout', retryable: true })
    expect(classifyModelError({ code: 'ETIMEDOUT' })).toMatchObject({ kind: 'timeout', retryable: true })
    const cliTimeout = new Error('Claude Code SDK query timed out after 600000ms')
    cliTimeout.name = 'AbortError'
    expect(classifyModelError(cliTimeout)).toMatchObject({ kind: 'timeout', retryable: true })
  })

  it('classifies network failures as retryable', () => {
    expect(classifyModelError(new Error('fetch failed'))).toMatchObject({ kind: 'network', retryable: true })
    expect(classifyModelError(new Error('read ECONNRESET'))).toMatchObject({ kind: 'network', retryable: true })
    expect(classifyModelError({ code: 'ECONNREFUSED' })).toMatchObject({ kind: 'network', retryable: true })
  })

  it('reads a wrapped network cause (undici style)', () => {
    const wrapped = new TypeError('fetch failed')
    ;(wrapped as any).cause = { code: 'ENOTFOUND' }
    expect(classifyModelError(wrapped)).toMatchObject({ kind: 'network', retryable: true })
  })

  it('classifies 4xx request errors as terminal invalid-request', () => {
    for (const status of [400, 404, 422]) {
      expect(classifyModelError({ status })).toMatchObject({ kind: 'invalid-request', retryable: false })
    }
  })

  it('classifies a ProviderRunError as terminal and keeps its subtype', () => {
    const err = new ProviderRunError('error_max_turns')
    expect(err.subtype).toBe('error_max_turns')
    expect(err).toBeInstanceOf(Error)
    expect(classifyModelError(err)).toMatchObject({ kind: 'provider-run-error', retryable: false })
  })

  it('classifies anything unrecognized as terminal other', () => {
    expect(classifyModelError(new Error('kaboom'))).toMatchObject({ kind: 'other', retryable: false })
    expect(classifyModelError(undefined)).toMatchObject({ kind: 'other', retryable: false })
    expect(classifyModelError({ status: 500 })).toMatchObject({ kind: 'other', retryable: false })
  })

  it('exposes the HTTP status when the error carried one', () => {
    expect(classifyModelError({ response: { status: 429 } }).status).toBe(429)
  })
})
