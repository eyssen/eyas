// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A6/G7 — a failed turn reaches the chat stream as the G1 ErrorFrame: its
// classification (kind, retryable), the code + params the web localizes for a
// failure EYAS can name (a CLI isolation failure: 'cliIsolation', never
// retryable), the provider, the raw text as `detail` and whether the partial
// answer was saved.

import { describe, it, expect } from 'vitest'
import { chatErrorFrame, errorDetail } from '@modules/conversations/error-frame.js'
import { CliIsolationError } from '@modules/model/cli-runtime/isolation.js'
import { CodedModelError } from '@shared/classify-model-error.js'

describe('chatErrorFrame', () => {
  it('a CLI isolation failure carries kind, code and params (positive)', () => {
    const err = new CliIsolationError('grok-cli', [
      { check: 'mcpServers', detail: 'mcpvault (~/.grok/config.toml)' },
      { check: 'hooks', detail: 'session_start' },
    ])
    expect(chatErrorFrame(err, { providerId: 'grok-cli', partialSaved: false })).toEqual({
      type: 'error',
      kind: 'isolation',
      retryable: false,
      code: 'cliIsolation',
      params: { provider: 'grok-cli', checks: 'mcpServers,hooks' },
      providerId: 'grok-cli',
      detail: err.message,
      partialSaved: false,
    })
  })

  it('a wrapped isolation failure is still recognised through its cause', () => {
    const inner = new CliIsolationError('kimi-cli', [{ check: 'permissionMode', detail: 'x' }])
    const outer = new Error('turn failed', { cause: inner })
    expect(chatErrorFrame(outer)).toMatchObject({ kind: 'isolation', code: 'cliIsolation', params: { provider: 'kimi-cli' } })
  })

  it('a coded failure passes its code and params through (positive)', () => {
    const frame = chatErrorFrame(new CodedModelError('isolation', 'cliIsolation.foreignMcpServer', { server: 'x' }), { partialSaved: true })
    expect(frame).toMatchObject({ kind: 'isolation', code: 'cliIsolation.foreignMcpServer', params: { server: 'x' }, partialSaved: true })
  })

  it('an ordinary failure has no code, only its kind (negative)', () => {
    const frame = chatErrorFrame(new Error('socket hang up'))
    expect(frame).toEqual({ type: 'error', kind: 'network', retryable: true, detail: 'socket hang up', partialSaved: false })
    expect(frame).not.toHaveProperty('code')
    expect(frame).not.toHaveProperty('error')
  })

  it('a missing error falls back to a generic detail', () => {
    expect(chatErrorFrame(undefined)).toMatchObject({ type: 'error', detail: 'Unknown error', kind: 'other', partialSaved: false })
    expect(errorDetail('plain text')).toBe('plain text')
  })
})
