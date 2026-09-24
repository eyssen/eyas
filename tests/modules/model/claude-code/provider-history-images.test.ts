// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H7 — Claude Code sees the images of earlier turns. EYAS replays the whole
// conversation in every prompt; an image sent in turn 1 used to be flattened
// away from the <conversation-history> frame, so the model saw an image only
// in the turn it was sent. Now the history is sent as SDK content blocks,
// each image at its place and the text split around it. A text-only history
// stays one plain string. Fictive conversations and images.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ captured: { prompt: undefined as any } }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    h.captured.prompt = args.prompt
    return (async function* () {
      const { fakeClaudeInit } = await import('../../../helpers/claude-sdk-init.js')
      yield fakeClaudeInit(args.options)
      yield { type: 'result', subtype: 'success', result: 'ok', session_id: 's1', usage: { input_tokens: 1, output_tokens: 1 } }
    })()
  },
  tool: (name: string, description: string, _schema: unknown, handler: unknown) => ({ name, description, handler }),
  createSdkMcpServer: (cfg: unknown) => ({ ...(cfg as object) }),
}))

import { createClaudeCodeProvider } from '@modules/model/submodules/claude-code/provider.js'
import type { ModelMessage } from '@modules/model/types.js'
import { TEST_CLAUDE_RUNTIME } from '../../../helpers/claude-runtime.js'

async function drain(gen: AsyncIterable<unknown>) { for await (const _ of gen) { /* consume */ } }

/** The content blocks of the SDKUserMessage the provider sent (a multimodal prompt). */
async function promptBlocks(): Promise<any[]> {
  const prompt = h.captured.prompt
  expect(typeof prompt).not.toBe('string')
  const sent: any[] = []
  for await (const message of prompt as AsyncIterable<any>) sent.push(message)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toMatchObject({ type: 'user', message: { role: 'user' }, parent_tool_use_id: null })
  return sent[0].message.content
}

const image = (data: string, mediaType = 'image/png') =>
  ({ type: 'image' as const, source: { type: 'base64' as const, mediaType, data } })

async function run(messages: ModelMessage[]): Promise<void> {
  const provider = createClaudeCodeProvider({ runtime: TEST_CLAUDE_RUNTIME })
  await drain(provider.stream({ messages, metadata: { conversationId: 'c1' } }))
}

describe('claude-code provider — images from earlier turns (H7)', () => {
  beforeEach(() => { h.captured.prompt = undefined })

  it('(+) images from turn 1 appear in the turn-3 prompt blocks, in order, the history text split around them', async () => {
    await run([
      { role: 'user', content: [image('AAA1'), image('AAA2', 'image/jpeg'), { type: 'text', text: 'compare these two charts' }] },
      { role: 'assistant', content: 'The first one grows faster.' },
      { role: 'user', content: 'and the second?' },
    ])
    const blocks = await promptBlocks()

    // The history frame, then the latest message's own blocks as they are.
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'image', 'text', 'text'])
    expect(blocks[0].text).toBe('<conversation-history>\nUser: ')
    expect(blocks[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA1' } })
    expect(blocks[2]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA2' } })
    expect(blocks[3].text).toBe('compare these two charts\n\nAssistant: The first one grows faster.\n</conversation-history>\n\n')
    expect(blocks[4]).toEqual({ type: 'text', text: 'and the second?' })
  })

  it('(+) an image-only earlier turn is kept, and the latest message keeps its own images after the history', async () => {
    await run([
      { role: 'user', content: [image('OLD')] },
      { role: 'assistant', content: 'A cat.' },
      { role: 'user', content: [image('NEW'), { type: 'text', text: 'and this one?' }] },
    ])
    const blocks = await promptBlocks()

    const images = blocks.filter((b) => b.type === 'image').map((b) => b.source.data)
    expect(images).toEqual(['OLD', 'NEW'])
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('|')
    expect(text).toBe('<conversation-history>\nUser: |\n\nAssistant: A cat.\n</conversation-history>\n\n|and this one?')
  })

  it('(+) a URL image travels as a URL source, not as base64 data', async () => {
    await run([
      { role: 'user', content: [{ type: 'image', source: { type: 'url', mediaType: 'image/png', data: 'https://example.test/chart.png' } }, { type: 'text', text: 'see' }] },
      { role: 'assistant', content: 'Seen.' },
      { role: 'user', content: 'again' },
    ])
    const blocks = await promptBlocks()
    expect(blocks.find((b) => b.type === 'image')).toEqual({ type: 'image', source: { type: 'url', url: 'https://example.test/chart.png' } })
  })

  it('(−) a text-only history stays a plain string prompt, exactly as before', async () => {
    await run([
      { role: 'user', content: [{ type: 'text', text: 'my name is Ada' }, { type: 'text', text: 'I like maps' }] },
      { role: 'assistant', content: 'Hello Ada' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'what is my name?' },
    ])
    expect(h.captured.prompt).toBe(
      '<conversation-history>\nUser: my name is Ada\nI like maps\n\nAssistant: Hello Ada\n</conversation-history>\n\nwhat is my name?',
    )
  })

  it('(−) a single text message is sent as-is, with no history frame', async () => {
    await run([{ role: 'user', content: 'hi' }])
    expect(h.captured.prompt).toBe('hi')
  })
})
