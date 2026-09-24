// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// H7 on the chat route: images the turn's model cannot see (its catalog row
// says no image input) reach the provider as a text stub, and the user is
// told through one notice frame from the turn sink, recorded in the reply's
// TurnMeta. A vision model gets the image bytes; a text-only turn, or a model
// EYAS has no catalog row for, gets no notice. Fictive providers and images.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { createTestDb, insertTestOwner } from '../../helpers/test-db.js'
import { createConversationRoutes } from '../../../src/modules/conversations/routes.js'
import { createConversationService, type ConversationService } from '../../../src/modules/conversations/conversation-service.js'
import { createModelGateway } from '../../../src/modules/model/gateway.js'
import { createProviderConfigService, type ProviderConfigService } from '../../../src/modules/model/provider-config-service.js'
import { createAgentRunner } from '../../../src/modules/agent/agent-runner.js'
import { imageOmittedText } from '../../../src/modules/model/helpers.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import type { AIProvider, ContentBlock, ModelRequest, StreamEvent } from '../../../src/modules/model/types.js'

const testDb = createTestDb('routes-images')

const PNG_BYTES = Buffer.from('fake-png-bytes')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

function framesOf(body: string): Array<Record<string, any>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => { try { return JSON.parse(line.slice(6)) } catch { return null } })
    .filter((f): f is Record<string, any> => f !== null && typeof f === 'object')
}

/** A documents service holding image and text attachments (only what the chat route reads). */
function fakeDocuments() {
  const docs: Record<string, { mimeType: string }> = {
    'img-1': { mimeType: 'image/png' },
    'img-2': { mimeType: 'image/png' },
    'txt-1': { mimeType: 'text/plain' },
  }
  return {
    link() { /* linked */ },
    getById(id: string) { return docs[id] ? { id, ...docs[id] } : null },
    async download(id: string) {
      if (!docs[id]) return null
      return {
        data: new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new Uint8Array(PNG_BYTES)); controller.close() },
        }),
      }
    },
  }
}

const blocksOf = (content: ModelRequest['messages'][number]['content']): ContentBlock[] =>
  typeof content === 'string' ? [{ type: 'text', text: content }] : content

describe('chat route — images the model cannot see (H7)', () => {
  let db: any
  let chat: ConversationService
  let catalog: ProviderConfigService
  let userId: string
  let streamed: ModelRequest[]

  beforeEach(async () => {
    db = testDb.open()
    userId = await insertTestOwner(db, `owner-${Date.now()}-${Math.random()}`)
    chat = createConversationService(db)
    catalog = createProviderConfigService(db)
    streamed = []
  })

  afterEach(() => testDb.cleanup())

  /** The catalog row of p1/m1: a vision model, a text-only one, or none at all. */
  function catalogRow(supportsImages: boolean | 'none'): void {
    if (supportsImages === 'none') return
    catalog.ensureProvider('p1')
    catalog.updateProvider('p1', { enabled: true })
    catalog.upsertModels('p1', [{
      id: 'm1', name: 'm1', provider: 'p1', contextWindow: 100_000, maxOutputTokens: 4_000,
      supportsTools: true, supportsImages, supportsStreaming: true,
    }])
  }

  function mount(branch: 'runner' | 'fallback'): Hono {
    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
        streamed.push({ ...request, signal: undefined })
        yield { type: 'text', text: 'seen' }
        yield {
          type: 'done',
          response: { id: 'r', provider: 'p1', model: 'm1', content: [{ type: 'text', text: 'seen' }], stopReason: 'end', usage: { inputTokens: 3, outputTokens: 1 } },
        }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)
    const runner = createAgentRunner({ gateway, toolExecutor: { execute: async () => ({ success: true, output: null }) } as any })
    const ability = makeAbility()
    const documents = fakeDocuments()
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })
    createConversationRoutes(
      app as any, chat, gateway, catalog,
      () => documents as any,                                 // getDocuments
      branch === 'runner' ? () => runner : undefined,          // getAgentRunner
    )
    return app
  }

  function conversation(): string {
    return chat.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1' }).id
  }

  async function send(app: Hono, id: string, body: { content?: string; attachmentIds?: string[] }): Promise<Array<Record<string, any>>> {
    const res = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'p1', model: 'm1', ...body }),
    })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    return framesOf(await res.text())
  }

  const sentBlocks = (): ContentBlock[] => streamed.at(-1)!.messages.flatMap((m) => blocksOf(m.content))
  const notices = (frames: Array<Record<string, any>>) => frames.filter((f) => f.type === 'notice')

  for (const branch of ['runner', 'fallback'] as const) {
    it(`(+) ${branch}: a text-only model gets the stub instead of the image, and the client one notice through the sink`, async () => {
      catalogRow(false)
      const id = conversation()
      const frames = await send(mount(branch), id, { content: 'what is on this?', attachmentIds: ['img-1'] })

      const blocks = sentBlocks()
      expect(blocks.some((b) => b.type === 'image')).toBe(false)
      expect(blocks).toContainEqual({ type: 'text', text: imageOmittedText('image/png') })
      expect(JSON.stringify(streamed.at(-1)!.messages)).not.toContain(PNG_BYTES.toString('base64'))

      expect(notices(frames)).toEqual([
        { type: 'notice', code: 'imagesNotVisible', params: { providerId: 'p1', modelId: 'm1', count: 1 } },
      ])
      // Said under the turn: after agent_start, before the reply.
      const types = frames.map((f) => f.type)
      expect(types.indexOf('notice')).toBeGreaterThan(types.indexOf('agent_start'))
      expect(types.indexOf('notice')).toBeLessThan(types.indexOf('done'))
      const done = frames.find((f) => f.type === 'done')!
      expect(done.turnMeta.notices).toEqual([{ code: 'imagesNotVisible', params: { providerId: 'p1', modelId: 'm1', count: 1 } }])
      // The stored user message keeps its attachment; only the copy sent was stubbed.
      const user = chat.get(id)!.messages.find((m) => m.role === 'user')!
      expect(user.attachmentIds).toEqual(['img-1'])
    })
  }

  it('(+) a vision model gets the image blocks, and no notice', async () => {
    catalogRow(true)
    const frames = await send(mount('runner'), conversation(), { content: 'what is on this?', attachmentIds: ['img-1'] })

    const images = sentBlocks().filter((b): b is Extract<ContentBlock, { type: 'image' }> => b.type === 'image')
    expect(images).toHaveLength(1)
    expect(images[0].source).toEqual({ type: 'base64', mediaType: 'image/png', data: PNG_BYTES.toString('base64') })
    expect(notices(frames)).toEqual([])
    expect(frames.find((f) => f.type === 'done')!.turnMeta.notices).toBeUndefined()
  })

  it('(+) an image from an earlier turn is counted too: the model cannot see it on this turn either', async () => {
    catalogRow(false)
    const id = conversation()
    const app = mount('runner')
    await send(app, id, { content: 'first', attachmentIds: ['img-1', 'img-2'] })
    const frames = await send(app, id, { content: 'and now?' })

    expect(sentBlocks().some((b) => b.type === 'image')).toBe(false)
    expect(notices(frames)).toEqual([
      { type: 'notice', code: 'imagesNotVisible', params: { providerId: 'p1', modelId: 'm1', count: 2 } },
    ])
  })

  it('(−) a text-only turn on a text-only model: messages untouched, no notice', async () => {
    catalogRow(false)
    const frames = await send(mount('runner'), conversation(), { content: 'just words', attachmentIds: ['txt-1'] })

    expect(sentBlocks().every((b) => b.type === 'text')).toBe(true)
    expect(JSON.stringify(streamed.at(-1)!.messages)).not.toContain('image omitted')
    expect(notices(frames)).toEqual([])
  })

  it('(−) a model EYAS has no catalog row for gets the image as it is (its provider decides), and no notice', async () => {
    catalogRow('none')
    const frames = await send(mount('fallback'), conversation(), { attachmentIds: ['img-1'] })

    expect(sentBlocks().filter((b) => b.type === 'image')).toHaveLength(1)
    expect(notices(frames)).toEqual([])
  })
})
