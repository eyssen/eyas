// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, afterEach } from 'vitest'
import {
  CliIsolationError,
  getIsolationStatus,
  resetIsolationStatuses,
  setIsolationStatus,
} from '@modules/model/cli-runtime/isolation.js'
import { classifyModelError, CodedModelError } from '@shared/classify-model-error.js'

afterEach(() => resetIsolationStatuses())

describe('IsolationStatus store', () => {
  it('is unverified for a provider nobody checked (fail closed)', () => {
    expect(getIsolationStatus('grok-cli')).toEqual({ status: 'unverified', checks: [], runtime: null, checkedAt: null })
  })

  it('records a verification with a timestamp and the runtime it ran on', () => {
    const set = setIsolationStatus('grok-cli', {
      status: 'verified',
      checks: [],
      runtime: { path: '/usr/local/bin/grok', version: '1.0.40', source: 'host' },
    })
    expect(set.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(getIsolationStatus('grok-cli')).toEqual(set)
    expect(getIsolationStatus('kimi-cli').status).toBe('unverified')
  })

  it('records a violation with its failed checks', () => {
    setIsolationStatus('grok-cli', {
      status: 'violation',
      checks: [{ check: 'mcpServers', detail: 'mcpvault' }],
      runtime: null,
      checkedAt: '2026-09-22T10:00:00.000Z',
    })
    expect(getIsolationStatus('grok-cli')).toMatchObject({ status: 'violation', checks: [{ check: 'mcpServers' }], checkedAt: '2026-09-22T10:00:00.000Z' })
  })

  it('hands out copies: a caller cannot mutate the stored status', () => {
    setIsolationStatus('grok-cli', { status: 'violation', checks: [{ check: 'hooks', detail: 'x' }], runtime: null })
    const got = getIsolationStatus('grok-cli')
    got.checks.push({ check: 'forged', detail: '' })
    got.status = 'verified'
    expect(getIsolationStatus('grok-cli')).toMatchObject({ status: 'violation', checks: [{ check: 'hooks' }] })
  })

  it('reset forgets one provider or all', () => {
    setIsolationStatus('grok-cli', { status: 'verified', checks: [], runtime: null })
    setIsolationStatus('kimi-cli', { status: 'auth-required', checks: [], runtime: null })
    resetIsolationStatuses('grok-cli')
    expect(getIsolationStatus('grok-cli').status).toBe('unverified')
    expect(getIsolationStatus('kimi-cli').status).toBe('auth-required')
    resetIsolationStatuses()
    expect(getIsolationStatus('kimi-cli').status).toBe('unverified')
  })
})

describe('CliIsolationError', () => {
  const err = new CliIsolationError('grok-cli', [
    { check: 'permissionMode', detail: 'always-approve' },
    { check: 'mcpServers', detail: 'mcpvault' },
  ])

  it('is a coded model error of kind isolation carrying the provider and checks', () => {
    expect(err).toBeInstanceOf(CodedModelError)
    expect(err.name).toBe('CliIsolationError')
    expect(err.kind).toBe('isolation')
    expect(err.code).toBe('cliIsolation')
    expect(err.params).toEqual({ provider: 'grok-cli', checks: 'permissionMode,mcpServers' })
    expect(err.violations).toHaveLength(2)
    expect(err.message).toMatch(/grok-cli/)
  })

  it('classifies as non-retryable isolation, also when wrapped as a cause', () => {
    expect(classifyModelError(err)).toMatchObject({ kind: 'isolation', retryable: false, code: 'cliIsolation' })
    const wrapped = new Error('turn failed', { cause: err })
    expect(classifyModelError(wrapped)).toMatchObject({ kind: 'isolation', retryable: false })
  })
})
