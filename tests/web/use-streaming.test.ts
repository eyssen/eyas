// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { processStreamEvent } from '../../src/web/src/hooks/use-streaming'
import { useConversationStore } from '../../src/web/src/stores/conversation-store'
import { planAutoTitle } from '../../src/shared/conversation-title'
import { useLanguageStore } from '../../src/web/src/stores/language-store'
import { noticeText, noticesOf } from '../../src/web/src/pages/conversations/turn-notices'
import { t } from '../../src/web/src/pages/conversations/i18n'
import { primeProviderCatalog } from './provider-catalog-fixture'

// Provider names come from the served catalog (G13), primed into the shared cache.
beforeEach(primeProviderCatalog)

function seedConversation(title: string | null = null) {
  useConversationStore.getState().setActiveConversation({
    id: 'c1',
    title,
    status: 'working',
    providerId: null,
    modelId: null,
    tokensUsed: 0,
    mode: 'simple',
    agentId: null,
    parentConversationId: null,
    complexity: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
  })
}

describe('optimistic first-turn title', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('names an untitled conversation from the first request', () => {
    seedConversation(null)
    const title = planAutoTitle(useConversationStore.getState().activeConversation?.title, 'Hány modul van a könyvtárban?')
    useConversationStore.getState().updateConversation({ title })
    expect(useConversationStore.getState().activeConversation?.title).toBe('Hány modul van a könyvtárban?')
  })

  it('does not overwrite a user-set title', () => {
    seedConversation('Már van neve')
    const title = planAutoTitle(useConversationStore.getState().activeConversation?.title, 'Hány modul van a könyvtárban?')
    expect(title).toBe('')
  })
})

describe('processStreamEvent title', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('applies a generated title to the active conversation', () => {
    seedConversation(null)
    processStreamEvent({ type: 'title', title: 'Fix the indexer' }, useConversationStore.getState())
    expect(useConversationStore.getState().activeConversation?.title).toBe('Fix the indexer')
  })

  it('replaces a placeholder title when the SSE title event arrives', () => {
    seedConversation('Névtelen')
    processStreamEvent({ type: 'title', title: 'Odoo 18 indexer' }, useConversationStore.getState())
    expect(useConversationStore.getState().activeConversation?.title).toBe('Odoo 18 indexer')
  })
})

describe('processStreamEvent god_started', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('keeps the conversation working with a live progress strip', () => {
    seedConversation('Calc')
    processStreamEvent({ type: 'god_started' }, useConversationStore.getState())
    const state = useConversationStore.getState()
    expect(state.activeConversation?.status).toBe('working')
    expect(state.agentProgress?.isRunning).toBe(true)
    expect(state.agentProgress?.agentName).toBe('God Mode')
  })
})

describe('a tool row settles only on its tool_result (G10)', () => {
  // The row opens on tool_use and only the call's own tool_result settles it,
  // matched by id whatever the row's status — the same on every provider.
  const store = () => useConversationStore.getState()
  const calls = () => store().agentProgress!.toolCalls

  function startRun() {
    seedConversation('T')
    processStreamEvent({ type: 'agent_start', agentId: null, maxTurns: 25 }, store())
  }

  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    store().clearStreamContent()
    startRun()
  })

  it('(+) tool_result settles its own row by id, even an error that arrives after other events (MISSED-R1A-M2)', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.ts' } }, store())
    processStreamEvent({ type: 'tool_use', id: 't2', name: 'write_file', input: { path: 'b.ts' } }, store())
    processStreamEvent({ type: 'tool_result', toolUseId: 't1', output: 'ok', outcome: 'success', durationMs: 12 }, store())
    processStreamEvent({ type: 'text', text: 'working on it' }, store())
    processStreamEvent({ type: 'turn_complete', turn: 1, tokensUsed: 50 }, store())
    processStreamEvent({ type: 'tool_result', toolUseId: 't2', output: 'EACCES', error: 'EACCES', outcome: 'error' }, store())
    expect(calls()[0]).toMatchObject({ toolUseId: 't1', status: 'success', output: 'ok', durationMs: 12 })
    expect(calls()[1]).toMatchObject({ toolUseId: 't2', status: 'error', error: 'EACCES' })
  })

  it('(+) a late error result reaches a row another path already closed', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'grep' }, store())
    store().updateToolCall('t1', { status: 'success' })
    processStreamEvent({ type: 'tool_result', toolUseId: 't1', error: 'budget exhausted', outcome: 'error' }, store())
    expect(calls()[0]).toMatchObject({ status: 'error', error: 'budget exhausted' })
  })

  it('(+) outcome denied renders as denied, approval_required as needing approval', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'run_command' }, store())
    processStreamEvent({ type: 'tool_use', id: 't2', name: 'send_email' }, store())
    processStreamEvent({ type: 'tool_result', toolUseId: 't1', error: 'Denied by policy', outcome: 'denied' }, store())
    processStreamEvent({ type: 'tool_result', toolUseId: 't2', error: 'Approval required', outcome: 'approval_required' }, store())
    expect(calls().map((c) => c.status)).toEqual(['denied', 'approval_required'])
  })

  it('(−) a skipped truncated call is not green', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'edit_file' }, store())
    processStreamEvent({ type: 'tool_result', toolUseId: 't1', error: 'not run: tool call limit per turn', outcome: 'skipped' }, store())
    expect(calls()[0].status).toBe('skipped')
    expect(calls()[0].status).not.toBe('success')
  })

  it('(−) a result without a known outcome is never a success; an unknown id is ignored', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'grep' }, store())
    processStreamEvent({ type: 'tool_result', toolUseId: 't1', output: 'x', outcome: 'brand-new' as any }, store())
    expect(calls()[0].status).toBe('unknown')
    processStreamEvent({ type: 'tool_result', toolUseId: 'nope', output: 'x', outcome: 'success' }, store())
    expect(calls()).toHaveLength(1)
  })

  it('(−) a row nothing settled reads as unknown, not success, once the run ends', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'search_tool' }, store())
    store().finishAgentProgress()
    expect(calls()[0].status).toBe('unknown')
  })

  it('(+) keeps the provider raw name; a repeated tool_use refines the row without reopening it', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'edit_file', rawName: 'Edit' }, store())
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'edit_file', rawName: 'Edit', input: { path: 'src/alpha.ts', oldString: 'a', newString: 'b' } }, store())
    expect(calls()).toHaveLength(1)
    expect(calls()[0]).toMatchObject({ rawName: 'Edit', input: { path: 'src/alpha.ts', oldString: 'a', newString: 'b' } })
    processStreamEvent({ type: 'tool_result', toolUseId: 't1', output: 'done', outcome: 'success' }, store())
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'edit_file' }, store())
    expect(calls()[0].status).toBe('success')
  })

  it('does not dump a [Tool: name...] line into the streaming prose', () => {
    processStreamEvent({ type: 'tool_use', id: 't1', name: 'edit_file', input: { path: 'a.ts' } }, store())
    expect(store().streamingText).not.toContain('[Tool:')
    expect(calls()).toHaveLength(1)
  })
})

describe('processStreamEvent progress, tokens and the colleague (G10)', () => {
  const store = () => useConversationStore.getState()

  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    seedConversation('T')
    store().clearStreamContent()
  })

  it('(+) agent_start keeps the colleague id (the panel resolves its name) and the turn budget', () => {
    processStreamEvent({ type: 'agent_start', agentId: 'agent-7', maxTurns: 25 }, store())
    expect(store().agentProgress).toMatchObject({ agentId: 'agent-7', maxTurns: 25, steps: 0, stepsKnown: false, isRunning: true })
    expect(store().agentProgress?.agentName).toBeUndefined()
  })

  it('(+) progress frames make the steps known; turn_complete tokens add up over the run', () => {
    processStreamEvent({ type: 'agent_start', agentId: null, maxTurns: 25 }, store())
    processStreamEvent({ type: 'progress', step: 3, maxSteps: 30 }, store())
    processStreamEvent({ type: 'turn_complete', turn: 1, tokensUsed: 1200 }, store())
    processStreamEvent({ type: 'turn_complete', turn: 2, tokensUsed: 800 }, store())
    expect(store().agentProgress).toMatchObject({ steps: 3, stepsKnown: true, maxTurns: 30, turn: 2, tokensUsed: 2000 })
  })

  it('(−) without progress frames the steps stay unknown (the panel counts tool calls instead)', () => {
    processStreamEvent({ type: 'agent_start', agentId: null, maxTurns: 25 }, store())
    processStreamEvent({ type: 'turn_complete', turn: 1, tokensUsed: 10 }, store())
    expect(store().agentProgress?.stepsKnown).toBe(false)
  })
})

describe('processStreamEvent approvals (G10)', () => {
  const store = () => useConversationStore.getState()

  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    seedConversation('T')
    store().clearStreamContent()
  })

  it('(+) approval_required adds one card entry; the park on the same approval does not add a second', () => {
    processStreamEvent({ type: 'agent_start', agentId: null, maxTurns: 25 }, store())
    processStreamEvent({ type: 'approval_required', toolUseId: 't1', toolName: 'send_email', reason: 'external recipient', approvalId: 42, riskTier: 'yellow' }, store())
    expect(store().approvals).toEqual([
      { key: 'approval-42', approvalId: 42, toolUseId: 't1', toolName: 'send_email', reason: 'external recipient', riskTier: 'yellow', decision: 'pending' },
    ])
    processStreamEvent({ type: 'parked_for_approval', approvalId: 42, toolName: 'send_email' }, store())
    expect(store().approvals).toHaveLength(1)
    expect(store().activeConversation?.status).toBe('waiting_approval')
  })

  it('(+) an approval without a queue row still gets a card; the next turn starts with none', () => {
    processStreamEvent({ type: 'approval_required', toolUseId: 't9', toolName: 'run_command', reason: 'needs review' }, store())
    expect(store().approvals[0]).toMatchObject({ key: 'tool-t9', decision: 'pending' })
    expect(store().approvals[0].approvalId).toBeUndefined()
    store().clearStreamContent()
    expect(store().approvals).toEqual([])
  })

  it('(−) a decision on an unknown card changes nothing', () => {
    processStreamEvent({ type: 'approval_required', toolUseId: 't1', toolName: 'x', reason: 'r', approvalId: 1 }, store())
    store().decideApproval('approval-999', 'approved')
    expect(store().approvals[0].decision).toBe('pending')
    store().decideApproval('approval-1', 'rejected')
    expect(store().approvals[0].decision).toBe('rejected')
  })
})

describe('processStreamEvent terminal frames (G10)', () => {
  const store = () => useConversationStore.getState()
  const turnMeta = {
    outcome: 'max_turns', stopReason: 'max_turns', usage: { inputTokens: 10, outputTokens: 5 }, costSource: 'estimate',
  } as const

  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    seedConversation('T')
    store().clearStreamContent()
  })
  afterEach(() => useLanguageStore.getState().setLang('en'))

  it('(+) a done frame adds exactly one message carrying turnMeta', () => {
    const message = { id: 7, role: 'assistant', content: 'partial answer', model: 'm', provider: 'p', tokensIn: 10, tokensOut: 5, createdAt: '' }
    processStreamEvent({ type: 'done', message, turnMeta: turnMeta as any }, store())
    const messages = store().activeConversation!.messages
    expect(messages).toHaveLength(1)
    expect(messages[0].turnMeta).toMatchObject({ outcome: 'max_turns' })
  })

  it('(+) a stored reply keeps its own turnMeta over the frame copy; a malformed message adds nothing', () => {
    const message = { id: 8, role: 'assistant', content: 'x', model: null, provider: null, tokensIn: 0, tokensOut: 0, createdAt: '', turnMeta: { outcome: 'completed' } }
    processStreamEvent({ type: 'done', message, turnMeta: turnMeta as any }, store())
    expect(store().activeConversation!.messages[0].turnMeta).toEqual({ outcome: 'completed' })
    processStreamEvent({ type: 'done', message: { nope: true }, turnMeta: turnMeta as any }, store())
    expect(store().activeConversation!.messages).toHaveLength(1)
  })

  it('(+) an error frame with code cliSignIn renders the code key with its params', () => {
    processStreamEvent({ type: 'error', kind: 'auth', retryable: false, code: 'cliSignIn', params: { provider: 'grok-cli' }, detail: 'raw 401 from the CLI', partialSaved: false }, store())
    const last = store().activeConversation!.messages.at(-1)!
    expect(last.content).toContain('Grok CLI is not signed in for EYAS')
    expect(last.content).not.toContain('raw 401')
    expect(last.error).toMatchObject({ source: 'stream', kind: 'auth', code: 'cliSignIn', detail: 'raw 401 from the CLI' })
  })

  it('(−) an unknown code falls back to the kind key; an unknown kind to other', () => {
    processStreamEvent({ type: 'error', kind: 'rate-limit', retryable: true, code: 'neverHeardOf', detail: 'x', partialSaved: false }, store())
    expect(store().activeConversation!.messages.at(-1)!.content).toBe(t('conversations.errors.rateLimit'))
    processStreamEvent({ type: 'error', kind: 'martian' as any, retryable: false, detail: 'y', partialSaved: false }, store())
    expect(store().activeConversation!.messages.at(-1)!.content).toBe(t('conversations.errors.other'))
    for (const m of store().activeConversation!.messages) expect(m.content).not.toMatch(/^Error:/)
  })

  it('(+) a failed turn keeps its partial answer on screen, then the error', () => {
    processStreamEvent({ type: 'agent_start', agentId: null, maxTurns: 25, binding: { providerId: 'claude-code', modelId: 'm1', source: 'conversation' } }, store())
    processStreamEvent({ type: 'text', text: 'Half of the answer' }, store())
    processStreamEvent({ type: 'error', kind: 'provider-run-error', retryable: false, detail: 'subtype error_during_execution', partialSaved: true, providerId: 'claude-code' }, store())
    const messages = store().activeConversation!.messages
    expect(messages.map((m) => m.content)).toEqual(['Half of the answer', t('conversations.errors.providerRunError')])
    expect(messages[0]).toMatchObject({ provider: 'claude-code', model: 'm1', turnMeta: { outcome: 'failed' } })
    expect(messages[1].error?.partialSaved).toBe(true)
  })

  it('(−) no partial answer when none was saved or nothing was written', () => {
    processStreamEvent({ type: 'text', text: 'streamed' }, store())
    processStreamEvent({ type: 'error', kind: 'timeout', retryable: true, detail: 'timed out', partialSaved: false }, store())
    expect(store().activeConversation!.messages).toHaveLength(1)
    store().clearStreamContent()
    processStreamEvent({ type: 'cancelled' }, store())
    expect(store().activeConversation!.messages).toHaveLength(1)
  })

  it('(+) a cancelled turn keeps what it wrote, marked as stopped', () => {
    processStreamEvent({ type: 'text', text: 'so far' }, store())
    processStreamEvent({ type: 'cancelled', reason: 'run aborted' }, store())
    expect(store().activeConversation!.messages.at(-1)).toMatchObject({ content: 'so far', turnMeta: { outcome: 'cancelled' } })
  })
})

describe('processStreamEvent cancelled', () => {
  it('marks the conversation idle and stops the progress strip', () => {
    seedConversation('T')
    useConversationStore.getState().setStreaming(true)
    useConversationStore.getState().setAgentProgress({
      agentName: 'Jarvis', turn: 1, maxTurns: 10,
      toolCalls: [{ toolUseId: 't1', toolName: 'grep', status: 'running' }],
      tokensUsed: 0, isRunning: true,
    } as any)
    processStreamEvent({ type: 'cancelled' } as any, useConversationStore.getState())
    const state = useConversationStore.getState()
    expect(state.activeConversation?.status).toBe('idle')
    expect(state.agentProgress?.isRunning).toBe(false)
    expect(state.agentProgress?.toolCalls.every((c) => c.status !== 'running')).toBe(true)
  })
})

describe('processStreamEvent plan_proposal', () => {
  it('parks the plan on the store and stops the run until a human answers', () => {
    seedConversation('T')
    processStreamEvent({
      type: 'plan_proposal',
      plan: { id: 'plan-1', goal: 'Refactor alpha', steps: [{ title: 'Read alpha' }] },
    } as any, useConversationStore.getState())
    const state = useConversationStore.getState()
    expect(state.planProposal?.goal).toBe('Refactor alpha')
    expect(state.activeConversation?.status).toBe('waiting_plan')
    expect(state.agentProgress?.isRunning ?? false).toBe(false)
  })
})


describe('processStreamEvent notice (H7)', () => {
  const store = () => useConversationStore.getState()
  const notice = { type: 'notice' as const, code: 'imagesNotVisible', params: { providerId: 'p1', modelId: 'm-text', count: 2 } }

  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    seedConversation('T')
    store().clearStreamContent()
  })
  afterEach(() => useLanguageStore.getState().setLang('en'))

  it('(+) stores the notice of the turn in flight and renders it through i18n in the user\'s language', () => {
    processStreamEvent(notice, store())
    expect(store().streamNotices).toEqual([{ code: 'imagesNotVisible', params: { providerId: 'p1', modelId: 'm-text', count: 2 } }])

    useLanguageStore.getState().setLang('en')
    const en = noticeText(store().streamNotices[0])
    expect(en).toContain('m-text')
    expect(en).toContain('2')
    expect(en).not.toContain('{{')
    expect(en).not.toBe('imagesNotVisible')

    useLanguageStore.getState().setLang('hu')
    const hu = noticeText(store().streamNotices[0])
    expect(hu).toContain('m-text')
    expect(hu).not.toBe(en)
  })

  it('(+) contextCompacted (a CLI compacted its context) renders its own text in every language, with or without params (G10)', () => {
    processStreamEvent({ type: 'notice', code: 'contextCompacted', params: { trigger: 'auto', preTokens: 180000 } }, store())
    processStreamEvent({ type: 'notice', code: 'contextCompacted' }, store())
    for (const lang of ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const) {
      useLanguageStore.getState().setLang(lang)
      for (const n of store().streamNotices) {
        const text = noticeText(n)
        expect(text, lang).not.toBeNull()
        expect(text, lang).not.toContain('{{')
        expect(text, lang).not.toBe('contextCompacted')
      }
    }
  })

  it('(+) a stored reply carries its notices in turnMeta', () => {
    expect(noticesOf({ outcome: 'completed', notices: [{ code: 'imagesNotVisible', params: { count: 1 } }] }))
      .toEqual([{ code: 'imagesNotVisible', params: { count: 1 } }])
    expect(noticesOf(null)).toEqual([])
    expect(noticesOf({ outcome: 'completed' })).toEqual([])
  })

  it('(−) a malformed notice is dropped, never shown raw; the next turn starts with none', () => {
    processStreamEvent({ type: 'notice', code: 'not a code!' } as any, store())
    processStreamEvent({ type: 'notice', code: 'imagesNotVisible', params: { count: { nested: true } } } as any, store())
    processStreamEvent({ type: 'notice', code: 'imagesNotVisible', params: { 'bad key': 1 } } as any, store())
    expect(store().streamNotices).toEqual([])

    processStreamEvent(notice, store())
    expect(store().streamNotices).toHaveLength(1)
    store().clearStreamContent()
    expect(store().streamNotices).toEqual([])
  })
})

// H5 — the turn in flight shows which model answers it (agent_start.binding),
// and a turn that fails on its binding is explained in the user's language.
describe('processStreamEvent agent_start binding and binding errors (H5)', () => {
  const store = () => useConversationStore.getState()

  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
    seedConversation('T')
    store().clearStreamContent()
  })
  afterEach(() => useLanguageStore.getState().setLang('en'))

  it('(+) stores the binding of the turn in flight; the next turn starts without one', () => {
    processStreamEvent({ type: 'agent_start', maxTurns: 5, binding: { providerId: 'grok-cli', modelId: 'alpha-large', source: 'agent' } }, store())
    expect(store().streamBinding).toEqual({ providerId: 'grok-cli', modelId: 'alpha-large', source: 'agent' })
    store().clearStreamContent()
    expect(store().streamBinding).toBeNull()
  })

  it('(−) an agent_start without a well-formed binding stores none', () => {
    processStreamEvent({ type: 'agent_start', maxTurns: 5 }, store())
    expect(store().streamBinding).toBeNull()
    processStreamEvent({ type: 'agent_start', maxTurns: 5, binding: { providerId: 'grok-cli' } as any }, store())
    expect(store().streamBinding).toBeNull()
  })

  it('(+) the binding error codes map to their localized text in every language, never the raw code', () => {
    const cases = [
      { code: 'model_binding_unavailable', params: { provider: 'grok-cli', model: 'alpha-large' } },
      { code: 'no_model_configured' },
      { code: 'binding_inherit_needs_agent' },
    ]
    for (const lang of ['en', 'hu', 'de', 'es', 'fr', 'tlh'] as const) {
      useLanguageStore.getState().setLang(lang)
      for (const c of cases) {
        seedConversation('T')
        processStreamEvent({ type: 'error', kind: 'invalid-request', retryable: false, detail: 'raw provider text', partialSaved: false, ...c } as any, store())
        const text = store().activeConversation!.messages.at(-1)!.content
        expect(text, `${lang}/${c.code}`).not.toContain('raw provider text')
        expect(text, `${lang}/${c.code}`).not.toContain(c.code)
        if (c.params) expect(text, `${lang}/${c.code}`).toContain('Grok CLI / alpha-large')
      }
    }
    useLanguageStore.getState().setLang('en')
    seedConversation('T')
    processStreamEvent({ type: 'error', kind: 'invalid-request', retryable: false, detail: 'x', partialSaved: false, code: 'model_binding_unavailable', params: { provider: 'grok-cli', model: 'alpha-large' } } as any, store())
    expect(store().activeConversation!.messages.at(-1)!.content).toContain('model picker')
  })
})
