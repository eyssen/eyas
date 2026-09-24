// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H6 — Kimi Code CLI shares the ACP prompt builder and runner with Grok:
// every turn replays EYAS's own history as content blocks with the images
// inline, images reach the CLI only when its initialize advertises them, and
// the catalog's Vision flag follows what the CLI reports.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKimiCliProvider, KIMI_CLI_KNOWN_MODELS } from '@modules/model/submodules/kimi-cli/provider.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { imageOmittedText } from '@modules/model/helpers.js'
import type { AcpContentBlock } from '@modules/model/submodules/grok-cli/acp-prompt.js'
import type { ModelMessage, StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../helpers/fake-acp.js'

const IMG1 = 'S0lNSS1PTkU='
const IMG2 = 'S0lNSS1UV08='
const png = (data: string) => ({ type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data } })
const turn1: ModelMessage[] = [{ role: 'user', content: [png(IMG1), { type: 'text', text: 'what is this?' }] }]
const turn2: ModelMessage[] = [
  ...turn1,
  { role: 'assistant', content: 'A dog.' },
  { role: 'user', content: [{ type: 'text', text: 'and this one?' }, png(IMG2)] },
]

afterEach(() => resetIsolationStatuses())

describe('Kimi CLI provider — prompt content blocks', () => {
  it('hands the runner the full EYAS history as content blocks on every turn, turn 1 image inline (positive)', async () => {
    const prompts: AcpContentBlock[][] = []
    async function* fakeRun(opts: { prompt: AcpContentBlock[] }) {
      prompts.push(opts.prompt)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = createKimiCliProvider({ runPrompt: fakeRun as any })
    for await (const _ of provider.stream({ messages: turn1 })) { /* drain */ }
    for await (const _ of provider.stream({ messages: turn2 })) { /* drain */ }
    expect(prompts[0]).toEqual([
      { type: 'image', mimeType: 'image/png', data: IMG1 },
      { type: 'text', text: 'what is this?' },
    ])
    expect(prompts[1]).toEqual([
      { type: 'text', text: '<conversation-history>\nUser: ' },
      { type: 'image', mimeType: 'image/png', data: IMG1 },
      { type: 'text', text: 'what is this?\n\nAssistant: A dog.\n</conversation-history>\n\nand this one?' },
      { type: 'image', mimeType: 'image/png', data: IMG2 },
    ])
  })

  it('a text-only turn gets text blocks only (negative)', async () => {
    const prompts: AcpContentBlock[][] = []
    async function* fakeRun(opts: { prompt: AcpContentBlock[] }) {
      prompts.push(opts.prompt)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const provider = createKimiCliProvider({ runPrompt: fakeRun as any })
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    expect(prompts[0]).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('keeps its catalog defaults until the CLI reports, then follows the report', async () => {
    const reports: Array<{ image: boolean }> = []
    async function* fakeRun(opts: { onPromptCapabilities?: (c: { image: boolean }) => void }) {
      opts.onPromptCapabilities?.({ image: false })
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    // F11: fetchModels reads the CLI's session; a stub probe stands in for it here.
    const runProbe = async () => ({ cliVersion: '1.52.0', defaultModelId: 'k2.6', models: [{ modelId: 'k2.6', name: 'kimi-k2.6', configOptions: [] }] })
    const provider = createKimiCliProvider({ runPrompt: fakeRun as any, runProbe: runProbe as any, probeCwd: () => '/nonexistent', onPromptCapabilities: (c) => reports.push(c) })
    expect((await provider.listModels()).map((m) => m.supportsImages)).toEqual(KIMI_CLI_KNOWN_MODELS.map((m) => m.supportsImages))
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    expect(reports).toEqual([{ image: false }])
    expect((await provider.listModels()).every((m) => m.supportsImages === false)).toBe(true)
    expect((await provider.fetchModels!()).every((m) => m.supportsImages === false)).toBe(true)
    // The exported catalog itself is not rewritten.
    expect(KIMI_CLI_KNOWN_MODELS.every((m) => m.supportsImages === true)).toBe(true)
  })
})

describe.skipIf(process.platform === 'win32')('Kimi CLI provider — through the shared runner and a fake kimi', () => {
  let root: string
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }) })

  async function runTurn(promptImage: boolean) {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-kimi-h6-')))
    const cwd = join(root, 'workspace')
    mkdirSync(cwd, { recursive: true })
    const log = join(root, 'kimi.log')
    const profile = fakeAcpProfile({ providerId: 'kimi-cli', homesDir: join(root, 'data', 'cli-homes'), dir: root, log, promptImage })
    const reports: Array<{ image: boolean }> = []
    const provider = createKimiCliProvider({ profile, onPromptCapabilities: (c) => reports.push(c) })
    const events: StreamEvent[] = []
    for await (const ev of provider.stream({ messages: turn2, metadata: { workingDirectory: cwd } })) events.push(ev)
    const sent = readFakeAcpLog(log).received.find((m) => m.method === 'session/prompt')!
    return { events, reports, sent: sent.params.prompt as Array<Record<string, unknown>> }
  }

  it('sends the image blocks when initialize advertises promptCapabilities.image (positive)', async () => {
    const { events, reports, sent } = await runTurn(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(reports).toEqual([{ image: true }])
    expect(sent.filter((b) => b.type === 'image')).toEqual([
      { type: 'image', mimeType: 'image/png', data: IMG1 },
      { type: 'image', mimeType: 'image/png', data: IMG2 },
    ])
  })

  it('without the capability sends the text stub, reports image:false and no image payload (negative)', async () => {
    const { events, reports, sent } = await runTurn(false)
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(reports).toEqual([{ image: false }])
    expect(sent.every((b) => b.type === 'text')).toBe(true)
    const wire = JSON.stringify(sent)
    expect(wire).not.toContain(IMG1)
    expect(wire).not.toContain(IMG2)
    expect(sent.map((b) => b.text).join('').split(imageOmittedText('image/png')).length - 1).toBe(2)
  })
})
