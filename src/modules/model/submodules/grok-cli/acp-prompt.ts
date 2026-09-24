// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * The session/prompt content of an ACP turn (Grok and Kimi).
 *
 * Every run opens a fresh ACP session and EYAS never loads or resumes one, so
 * each turn carries EYAS's own history: a <conversation-history> text frame
 * with the earlier turns' images inline where they were sent, then the latest
 * message's text and images. This is conversation content only; the system
 * prompt travels on its own channel.
 *
 * Whether the images reach the model is the CLI's call: it says so in
 * initialize (agentCapabilities.promptCapabilities.image). Without that, every
 * image becomes a text stub (imageOmittedText) before the prompt is sent.
 */

import { z } from 'zod'
import type { ContentBlock, ModelMessage } from '../../types.js'
import { imageOmittedText } from '../../helpers.js'

/** ACP TextContent. */
export interface AcpTextBlock {
  type: 'text'
  text: string
}

/** ACP ImageContent: base64 data with its MIME type. */
export interface AcpImageBlock {
  type: 'image'
  mimeType: string
  data: string
}

export type AcpContentBlock = AcpTextBlock | AcpImageBlock

/** What the CLI said it accepts in a prompt. */
export interface AcpPromptCapabilities {
  image: boolean
}

/** Collects blocks, joining adjacent text into one block. */
class BlockWriter {
  readonly blocks: AcpContentBlock[] = []

  text(text: string): void {
    if (!text) return
    const last = this.blocks[this.blocks.length - 1]
    if (last?.type === 'text') last.text += text
    else this.blocks.push({ type: 'text', text })
  }

  image(block: AcpImageBlock): void {
    this.blocks.push(block)
  }
}

/**
 * One message's parts in their own order. Adjacent text blocks are joined
 * with a newline; tool blocks carry no conversation text here. An image EYAS
 * only has as a URL cannot be an ACP image (ACP takes the bytes), so it is
 * named as a text reference instead of dropped.
 */
function messageParts(content: string | ContentBlock[]): AcpContentBlock[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  const parts: AcpContentBlock[] = []
  for (const block of content) {
    if (block.type === 'text') {
      if (!block.text) continue
      const last = parts[parts.length - 1]
      if (last?.type === 'text') last.text += `\n${block.text}`
      else parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      if (block.source.type === 'base64') {
        parts.push({ type: 'image', mimeType: block.source.mediaType, data: block.source.data })
      } else {
        const ref = `[image: ${block.source.data.replace(/\s+/g, ' ').trim()}]`
        const last = parts[parts.length - 1]
        if (last?.type === 'text') last.text += `\n${ref}`
        else parts.push({ type: 'text', text: ref })
      }
    }
  }
  return parts
}

function hasContent(parts: readonly AcpContentBlock[]): boolean {
  return parts.some((p) => p.type === 'image' || p.text.trim().length > 0)
}

/**
 * The prompt for one ACP turn, built from the whole EYAS conversation.
 * Earlier turns go into a <conversation-history> frame (a turn with neither
 * text nor an image is left out), each image at its place in turn order; the
 * last message follows with its own text and images. A text-only
 * conversation is a single text block.
 */
export function buildAcpPrompt(messages: readonly ModelMessage[]): AcpContentBlock[] {
  if (messages.length === 0) return [{ type: 'text', text: '' }]
  const out = new BlockWriter()

  const history = messages
    .slice(0, -1)
    .map((m) => ({ role: m.role, parts: messageParts(m.content) }))
    .filter((h) => hasContent(h.parts))
  if (history.length > 0) {
    out.text('<conversation-history>\n')
    history.forEach((turn, i) => {
      out.text(`${i > 0 ? '\n\n' : ''}${turn.role === 'user' ? 'User' : 'Assistant'}: `)
      for (const part of turn.parts) {
        if (part.type === 'text') out.text(part.text)
        else out.image(part)
      }
    })
    out.text('\n</conversation-history>\n\n')
  }

  for (const part of messageParts(messages[messages.length - 1].content)) {
    if (part.type === 'text') out.text(part.text)
    else out.image(part)
  }
  return out.blocks.length > 0 ? out.blocks : [{ type: 'text', text: '' }]
}

/**
 * The same prompt for a CLI that cannot take images: each image becomes the
 * shared text stub at its place, so the model still learns an image was there.
 */
export function stubAcpImages(blocks: readonly AcpContentBlock[]): AcpContentBlock[] {
  const out = new BlockWriter()
  let afterStub = false
  for (const block of blocks) {
    if (block.type === 'image') {
      const before = out.blocks[out.blocks.length - 1]
      const sep = before?.type === 'text' && !/\s$/.test(before.text) ? '\n' : ''
      out.text(`${sep}${imageOmittedText(block.mimeType)}`)
      afterStub = true
      continue
    }
    out.text(afterStub && block.text && !/^\s/.test(block.text) ? `\n${block.text}` : block.text)
    afterStub = false
  }
  return out.blocks.length > 0 ? out.blocks : [{ type: 'text', text: '' }]
}

/** True when the prompt carries at least one image block. */
export function hasAcpImages(blocks: readonly AcpContentBlock[]): boolean {
  return blocks.some((b) => b.type === 'image')
}

const InitializeResultSchema = z
  .object({
    agentCapabilities: z
      .object({
        promptCapabilities: z.object({ image: z.unknown().optional() }).passthrough().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough()

/**
 * Read the prompt capabilities from the CLI's initialize result. Only an
 * explicit `image: true` counts; anything missing, malformed or false means
 * no images (ACP's own default for an agent that does not say).
 */
export function readAcpPromptCapabilities(initializeResult: unknown): AcpPromptCapabilities {
  const parsed = InitializeResultSchema.safeParse(initializeResult)
  if (!parsed.success) return { image: false }
  return { image: parsed.data.agentCapabilities?.promptCapabilities?.image === true }
}
