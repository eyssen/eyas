// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — the marker the approval queue uses to explain an unsandboxed-shell
// approval, and the notice code a CLI turn without a sandbox raises.

import { describe, expect, it } from 'vitest'
import { UNSANDBOXED_SHELL_REASON, UNSANDBOXED_SHELL_REASON_TAG, isUnsandboxedShellReason } from '@shared/cli-sandbox.js'
import { NoticeSchema } from '@shared/chat-stream.js'

describe('unsandboxed-shell reason marker', () => {
  it('recognises the gate reason, also inside the bridge wording', () => {
    expect(UNSANDBOXED_SHELL_REASON.startsWith(UNSANDBOXED_SHELL_REASON_TAG)).toBe(true)
    expect(isUnsandboxedShellReason(UNSANDBOXED_SHELL_REASON)).toBe(true)
    expect(isUnsandboxedShellReason(`approval required for Bash (gate escalated): ${UNSANDBOXED_SHELL_REASON}`)).toBe(true)
  })

  it('negative: any other reason or value is not one', () => {
    expect(isUnsandboxedShellReason('red tier — escalating to LLM judge')).toBe(false)
    expect(isUnsandboxedShellReason(null)).toBe(false)
    expect(isUnsandboxedShellReason(undefined)).toBe(false)
  })
})

describe('notice cliSandboxUnavailable', () => {
  it('is a valid notice with provider and reason params', () => {
    expect(NoticeSchema.safeParse({ code: 'cliSandboxUnavailable', params: { provider: 'Grok CLI', reason: 'no-bwrap' } }).success).toBe(true)
  })

  it('negative: an unknown code is still refused', () => {
    expect(NoticeSchema.safeParse({ code: 'sandboxOff' }).success).toBe(false)
  })
})
