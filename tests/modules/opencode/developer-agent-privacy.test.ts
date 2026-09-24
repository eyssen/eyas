// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D5 — an OpenCode task sends its prompt and EYAS's recalled memory (the
// `system` text) past the model gateway, to whatever model OpenCode runs. Both
// are masked by the privacy policy's one function (remote) before anything
// reaches the sidecar; without the privacy module they go out unchanged.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { createDeveloperAgent, type DeveloperAgentDeps } from '@modules/opencode/developer-agent'
import type { OpencodeClient } from '@modules/opencode/opencode-client'
import type { MemoryRecall } from '@modules/memory/v2/assemble'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

const logger = pino({ level: 'silent' })

const EMAIL = 'billing@example.com'
const IBAN = 'HU42 1177 3016 1111 1018 0000 0000'
const PHONE = '+36 30 123 4567'
const MEMORY_BLOCK = `<eyas-memory>\n- 2026-09-08 invoice contact ${EMAIL}, account ${IBAN}\n</eyas-memory>`
const PROMPT = `Write the invoice mailer for ${EMAIL} (call ${PHONE} on 2026-09-08)`

function fakeClient() {
  const prompts: Array<Parameters<OpencodeClient['prompt']>[1]> = []
  const titles: string[] = []
  const make = (directory: string | null): OpencodeClient => ({
    baseUrl: 'http://127.0.0.1:1',
    directory,
    forDirectory: (dir) => make(dir),
    health: async () => ({ healthy: true, version: '1.18.29' }),
    createSession: async (opts) => {
      titles.push(String((opts as { title?: string } | undefined)?.title ?? ''))
      return { id: 'ses_1' }
    },
    prompt: async (_sid, body) => {
      prompts.push(body)
      return { text: 'done' }
    },
    listProviders: async () => ({ providers: [], defaults: {} }),
    abort: async () => undefined,
    diff: async () => [],
    replyPermission: async () => undefined,
    deleteSession: async () => undefined,
    subscribeEvents: (signal, onEvent) => {
      onEvent({ type: 'server.connected', properties: {} })
      return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    },
  })
  return { client: make(null), prompts, titles }
}

describe('OpenCode task — privacy on the prompt and the memory hydration', () => {
  let dir: string
  let fx: PrivacyFixture | undefined

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-oc-privacy-')))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    fx?.cleanup()
    fx = undefined
  })

  function agent(server: ReturnType<typeof fakeClient>, getPrivacy?: DeveloperAgentDeps['getPrivacy']) {
    const recall: MemoryRecall = async () => ({ content: MEMORY_BLOCK }) as Awaited<ReturnType<MemoryRecall>>
    return createDeveloperAgent({
      getClient: async () => server.client,
      getRecall: () => recall,
      ...(getPrivacy ? { getPrivacy } : {}),
      resolveCwd: () => dir,
      logger,
      eventStreamWaitMs: 50,
    })
  }

  const input = { prompt: PROMPT, conversationId: 'conv-1', userId: 'u1', runId: 'run-1', agentId: 'agent-1' }

  it('(+) the system hydration, the prompt and the session title are masked before client.prompt; dates stay', async () => {
    fx = createPrivacyFixture({})
    const server = fakeClient()
    const result = await agent(server, () => fx!.service).run(input)
    expect(result.ok).toBe(true)
    const sent = server.prompts[0]
    expect(sent.system).toBe('<eyas-memory>\n- 2026-09-08 invoice contact [EMAIL], account [IBAN]\n</eyas-memory>')
    expect(sent.parts).toEqual([{ type: 'text', text: 'Write the invoice mailer for [EMAIL] (call [PHONE] on 2026-09-08)' }])
    expect(server.titles[0]).not.toContain(EMAIL)
    expect(JSON.stringify(server.prompts)).not.toContain(IBAN)
  })

  it('(+) one digest for the task: opencode transport, the task identity, types only', async () => {
    fx = createPrivacyFixture({})
    // A spy on the service's own method (it still runs the real redaction):
    // Vitest 4 types a `vi.fn(generic)` mock with the generic's parameters
    // erased, so it no longer fits where the generic method is expected.
    const redact = vi.spyOn(fx.service, 'redactToolOutput')
    await agent(fakeClient(), () => fx!.service).run(input)
    expect(redact).toHaveBeenCalledTimes(1)
    expect(redact.mock.calls[0][0]).toBe('opencode_run')
    expect(redact.mock.calls[0][2]).toEqual({ transport: 'opencode', conversationId: 'conv-1', runId: 'run-1', agentId: 'agent-1' })
    const digest = redact.mock.results[0].value.digest
    expect(digest).toMatchObject({ transport: 'opencode', toolName: 'opencode_run', byType: { email: 2, iban: 1, phone: 1 } })
    expect(JSON.stringify(digest)).not.toContain(EMAIL)
  })

  it('(−) with no privacy service the prompt and the hydration are unchanged', async () => {
    const server = fakeClient()
    await agent(server).run(input)
    expect(server.prompts[0].system).toBe(MEMORY_BLOCK)
    expect(server.prompts[0].parts).toEqual([{ type: 'text', text: PROMPT }])
  })

  it('(−) a disabled policy leaves them unchanged too', async () => {
    fx = createPrivacyFixture({ enabled: false })
    const server = fakeClient()
    await agent(server, () => fx!.service).run(input)
    expect(server.prompts[0].system).toBe(MEMORY_BLOCK)
    expect(server.prompts[0].parts).toEqual([{ type: 'text', text: PROMPT }])
  })

  it('(−) a privacy scan that throws fails the task before anything reaches OpenCode', async () => {
    const server = fakeClient()
    const result = await agent(server, () => ({ redactToolOutput: () => { throw new Error('policy store gone') } })).run(input)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/privacy scan failed/)
    expect(server.titles).toEqual([])
    expect(server.prompts).toEqual([])
  })
})
