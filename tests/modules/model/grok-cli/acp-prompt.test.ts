// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H6 — the ACP prompt is EYAS's whole conversation as content blocks: a
// <conversation-history> frame with the earlier images inline in turn order,
// then the latest message's text and images. A CLI that takes no image input
// gets the shared text stub in each image's place.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildAcpPrompt,
  hasAcpImages,
  readAcpPromptCapabilities,
  stubAcpImages,
} from '@modules/model/submodules/grok-cli/acp-prompt.js'
import { imageOmittedText } from '@modules/model/helpers.js'
import type { ModelMessage } from '@modules/model/types.js'

const png = (data: string) => ({ type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data } })

describe('buildAcpPrompt', () => {
  it('keeps turn order: turn 1 image inline in the history frame, the last image after the last text (positive)', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [png('IMG1'), { type: 'text', text: 'what is this?' }] },
      { role: 'assistant', content: 'A cat.' },
      { role: 'user', content: [{ type: 'text', text: 'and this one?' }, png('IMG2')] },
    ]
    expect(buildAcpPrompt(messages)).toEqual([
      { type: 'text', text: '<conversation-history>\nUser: ' },
      { type: 'image', mimeType: 'image/png', data: 'IMG1' },
      { type: 'text', text: 'what is this?\n\nAssistant: A cat.\n</conversation-history>\n\nand this one?' },
      { type: 'image', mimeType: 'image/png', data: 'IMG2' },
    ])
  })

  it('an image-only earlier turn stays in the history instead of vanishing (positive)', () => {
    const blocks = buildAcpPrompt([
      { role: 'user', content: [png('ONLY')] },
      { role: 'assistant', content: 'Got it.' },
      { role: 'user', content: 'describe it again' },
    ])
    expect(blocks.filter((b) => b.type === 'image')).toEqual([{ type: 'image', mimeType: 'image/png', data: 'ONLY' }])
    expect(blocks[0]).toEqual({ type: 'text', text: '<conversation-history>\nUser: ' })
  })

  it('a text-only history is one text block: the history frame, then the latest message (negative: no image blocks)', () => {
    const blocks = buildAcpPrompt([
      { role: 'user', content: 'my name is Ada' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'Ada' }] },
      { role: 'user', content: 'what is my name?' },
    ])
    expect(blocks).toEqual([{
      type: 'text',
      text: '<conversation-history>\nUser: my name is Ada\n\nAssistant: Hello\nAda\n</conversation-history>\n\nwhat is my name?',
    }])
    expect(hasAcpImages(blocks)).toBe(false)
  })

  it('a single message has no history frame; an empty conversation is one empty text block', () => {
    expect(buildAcpPrompt([{ role: 'user', content: 'hi' }])).toEqual([{ type: 'text', text: 'hi' }])
    expect(buildAcpPrompt([])).toEqual([{ type: 'text', text: '' }])
  })

  it('leaves out earlier turns with neither text nor an image, and tool blocks carry nothing (negative)', () => {
    const blocks = buildAcpPrompt([
      { role: 'user', content: '   ' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
      { role: 'user', content: 'now' },
    ])
    expect(blocks).toEqual([{ type: 'text', text: 'now' }])
  })

  it('names an image EYAS only has as a URL in text instead of sending an ACP image (negative)', () => {
    const blocks = buildAcpPrompt([
      { role: 'user', content: [{ type: 'image', source: { type: 'url', mediaType: 'image/png', data: 'https://example.test/a.png' } }, { type: 'text', text: 'see' }] },
    ])
    expect(hasAcpImages(blocks)).toBe(false)
    expect(blocks).toEqual([{ type: 'text', text: '[image: https://example.test/a.png]\nsee' }])
  })
})

describe('stubAcpImages', () => {
  it('puts the shared stub where each image was and sends no image payload', () => {
    const blocks = buildAcpPrompt([
      { role: 'user', content: [png('IMG1'), { type: 'text', text: 'what is this?' }] },
      { role: 'assistant', content: 'A cat.' },
      { role: 'user', content: [{ type: 'text', text: 'and this?' }, png('IMG2')] },
    ])
    const stubbed = stubAcpImages(blocks)
    expect(hasAcpImages(stubbed)).toBe(false)
    expect(JSON.stringify(stubbed)).not.toContain('IMG1')
    expect(JSON.stringify(stubbed)).not.toContain('IMG2')
    const stub = imageOmittedText('image/png')
    expect(stubbed).toEqual([{
      type: 'text',
      text: `<conversation-history>\nUser: ${stub}\nwhat is this?\n\nAssistant: A cat.\n</conversation-history>\n\nand this?\n${stub}`,
    }])
  })

  it('leaves a prompt without images as it was (negative)', () => {
    const blocks = [{ type: 'text' as const, text: 'plain' }]
    expect(stubAcpImages(blocks)).toEqual(blocks)
  })
})

describe('readAcpPromptCapabilities', () => {
  it('reads image: true as image input (positive)', () => {
    expect(readAcpPromptCapabilities({ agentCapabilities: { promptCapabilities: { image: true } } })).toEqual({ image: true })
  })

  it('reads the recorded grok 1.0.40 initialize as no image input', () => {
    const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../../../fixtures/cli/grok/1.0.40/initialize.json', import.meta.url)), 'utf8'))
    expect(readAcpPromptCapabilities(fixture)).toEqual({ image: false })
  })

  it('treats anything but an explicit true as no image input (negative)', () => {
    for (const result of [
      null,
      undefined,
      'garbage',
      {},
      { agentCapabilities: null },
      { agentCapabilities: {} },
      { agentCapabilities: { promptCapabilities: { image: 'true' } } },
      { agentCapabilities: { promptCapabilities: { image: 1 } } },
      { agentCapabilities: 'x' },
    ]) {
      expect(readAcpPromptCapabilities(result)).toEqual({ image: false })
    }
  })
})
