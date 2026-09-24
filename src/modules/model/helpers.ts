import type { ContentBlock, ModelMessage } from './types.js'

/**
 * The history without any ThinkingBlock: for a request whose prefix no longer
 * matches the one the blocks were produced under (a checkpoint-seeded resume)
 * and for adapters whose dialect cannot replay them. A message left with no
 * content once its thinking is gone is dropped (it carried nothing else); a
 * message without thinking blocks keeps its identity, so an unchanged history
 * comes back as the same array.
 */
export function stripThinkingBlocks(messages: ModelMessage[]): ModelMessage[] {
  let changed = false
  const out: ModelMessage[] = []
  for (const message of messages) {
    if (typeof message.content === 'string' || !message.content.some((b) => b?.type === 'thinking')) {
      out.push(message)
      continue
    }
    changed = true
    const content = message.content.filter((b) => b?.type !== 'thinking')
    if (content.length > 0) out.push({ ...message, content })
  }
  return changed ? out : messages
}

export function contentToText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')
}

export function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

/**
 * The text that stands in for an image a model cannot see (a CLI that does
 * not advertise image input, a non-vision model). The model learns that an
 * image was there and why it is missing, instead of the image vanishing.
 * Model-facing, not UI text. The MIME type comes from an upload, so only a
 * plain `type/subtype` survives into the prompt.
 */
export function imageOmittedText(mediaType: string): string {
  const type = /^[a-z0-9][a-z0-9.+-]{0,40}\/[a-z0-9][a-z0-9.+-]{0,60}$/i.test(mediaType) ? mediaType : 'image'
  return `[image omitted (${type}): this model cannot see images]`
}

/**
 * The history for a model that cannot see images: every ImageBlock becomes
 * the imageOmittedText stub at its place, and `count` says how many were
 * replaced (the caller tells the user). A history without images comes back
 * as the same array with count 0; a message without images keeps its identity.
 */
export function stubUnsupportedImages(messages: ModelMessage[]): { messages: ModelMessage[]; count: number } {
  let count = 0
  const out = messages.map((message) => {
    if (typeof message.content === 'string' || !message.content.some((b) => b?.type === 'image')) return message
    const content = message.content.map((block): ContentBlock => {
      if (block?.type !== 'image') return block
      count++
      return { type: 'text', text: imageOmittedText(block.source?.mediaType ?? '') }
    })
    return { ...message, content }
  })
  return count > 0 ? { messages: out, count } : { messages, count: 0 }
}

/**
 * The concrete model a backend reported answering (ModelResponse.resolvedModelId),
 * or undefined when it named none. Only a plain, bounded string counts.
 */
export function reportedModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return id && id.length <= 300 ? id : undefined
}

/**
 * A response that names the EYAS model id it was asked for and, separately,
 * the model the backend reported (when it reported one).
 */
export function withResolvedModel<T extends { model: string; resolvedModelId?: string }>(response: T, requestedModel: string, reported: unknown): T {
  const resolved = reportedModelId(reported)
  const { resolvedModelId: _stale, ...rest } = response
  return { ...rest, model: requestedModel, ...(resolved ? { resolvedModelId: resolved } : {}) } as T
}

/** `{ resolvedModelId }` for a response literal, or nothing when the backend named no model. */
export function resolvedModelField(reported: unknown): { resolvedModelId?: string } {
  const resolved = reportedModelId(reported)
  return resolved ? { resolvedModelId: resolved } : {}
}
