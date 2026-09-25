// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// ONE taxonomy decides whether the gateway may retry a failed provider call.
// Getting it wrong is expensive in both directions: retrying a 401 or a
// caller-abort burns budget on a call that can never succeed, while treating a
// 429/529/timeout as terminal fails a run that a single retry would have saved
// (D9). Retryable is exactly {rate-limit, overload, timeout, network}.

import { describe, it, expect } from 'vitest'
import { classifyModelError, CodedModelError, isModelErrorKind, MODEL_ERROR_KINDS, ProviderRunError } from '@shared/classify-model-error.js'

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

describe('CodedModelError', () => {
  it('keeps kind, code and params through classification', () => {
    const err = new CodedModelError('auth', 'cliSignIn', { provider: 'grok-cli' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('CodedModelError')
    expect(classifyModelError(err)).toEqual({ kind: 'auth', retryable: false, code: 'cliSignIn', params: { provider: 'grok-cli' } })
  })

  it('derives retryable from the kind', () => {
    expect(classifyModelError(new CodedModelError('rate-limit', 'quota'))).toMatchObject({ retryable: true, code: 'quota' })
  })

  it('is found when wrapped as a cause, even under a ProviderRunError', () => {
    const coded = new CodedModelError('invalid-request', 'bindingUnavailable', { model: 'm1' })
    const wrapped = new Error('turn failed')
    ;(wrapped as any).cause = coded
    expect(classifyModelError(wrapped)).toMatchObject({ kind: 'invalid-request', code: 'bindingUnavailable', params: { model: 'm1' } })
    const run = new ProviderRunError('error_during_execution')
    ;(run as any).cause = coded
    expect(classifyModelError(run)).toMatchObject({ code: 'bindingUnavailable' })
    const viaOption = new CodedModelError('other', 'outer', undefined, { cause: new Error('inner') })
    expect((viaOption as any).cause).toBeInstanceOf(Error)
  })

  it('copies params so later mutation of the source cannot leak into a classification', () => {
    const params = { provider: 'grok-cli' }
    const err = new CodedModelError('auth', 'cliSignIn', params)
    params.provider = 'changed'
    expect(classifyModelError(err).params).toEqual({ provider: 'grok-cli' })
  })

  it('a plain error carries no code or params', () => {
    const c = classifyModelError(new Error('invalid api key'))
    expect(c.code).toBeUndefined()
    expect(c.params).toBeUndefined()
    expect(classifyModelError({ status: 429 }).code).toBeUndefined()
  })
})

describe("'isolation' kind", () => {
  it('is part of the taxonomy and never retryable', () => {
    expect(MODEL_ERROR_KINDS).toContain('isolation')
    const c = classifyModelError(new CodedModelError('isolation', 'cliIsolation', { provider: 'grok-cli', checks: 'hooks' }))
    expect(c).toMatchObject({ kind: 'isolation', retryable: false, code: 'cliIsolation' })
  })

  it('is not inferred from provider text that merely mentions isolation', () => {
    expect(classifyModelError(new Error('sandbox isolation unavailable')).kind).not.toBe('isolation')
  })
})

describe('isModelErrorKind', () => {
  it('accepts every kind of the taxonomy and nothing else', () => {
    for (const kind of MODEL_ERROR_KINDS) expect(isModelErrorKind(kind)).toBe(true)
    for (const bad of ['meltdown', '', 'toString', 42, null]) expect(isModelErrorKind(bad)).toBe(false)
  })
})
