// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { editDesign, createDesignFromBrief, chooseTier, extractJsonObject, createDesignCompletion } from '@modules/design/design-ai'
import { createModelGateway } from '@modules/model/gateway'
import type { AIProvider, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import { DESIGN_EDITOR_PROMPT } from '@modules/design/design-prompt'

const board = (body = '<p>hi</p>') => `<x-dc><helmet><style>body{margin:0}</style></helmet>${body}</x-dc>`
const files = (n = 1) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [i === 0 ? 'Main.dc.html' : `A${i}.dc.html`, board()]),
)

const filesReply = (f: Record<string, string>) => JSON.stringify({ files: f })
const fileReply = (name: string, content: string) => JSON.stringify({ file: name, content })

describe('chooseTier', () => {
  it('rewrites the whole canvas for a small one', () => {
    expect(chooseTier(files(1), {})).toBe('whole-canvas')
    expect(chooseTier(files(3), {})).toBe('whole-canvas')
  })
  it('switches to per-artboard past the limit', () => {
    expect(chooseTier(files(4), {})).toBe('per-artboard')
  })
  it('an explicit target always forces per-artboard', () => {
    expect(chooseTier(files(1), { targetFile: 'Main.dc.html' })).toBe('per-artboard')
  })
})

describe('extractJsonObject', () => {
  it('finds the object inside a fence and handles braces in strings', () => {
    expect(extractJsonObject('```json\n{"a":"}"}\n```')).toBe('{"a":"}"}')
    expect(extractJsonObject('nope')).toBeNull()
  })
})

describe('editDesign — whole canvas', () => {
  it('accepts a valid rewrite on the first attempt', async () => {
    const complete = vi.fn().mockResolvedValue(filesReply({ 'Main.dc.html': board('<b>new</b>') }))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'make it bold' })
    expect(r.ok).toBe(true)
    expect(r.tier).toBe('whole-canvas')
    expect(r.attempts).toBe(1)
    expect(r.files!['Main.dc.html']).toContain('<b>new</b>')
  })

  it('sends the built-in prompt and the instruction', async () => {
    const complete = vi.fn().mockResolvedValue(filesReply({ 'Main.dc.html': board() }))
    await editDesign({ complete }, { files: files(1), instruction: 'tighten the hero' })
    expect(complete.mock.calls[0][0].system).toContain(DESIGN_EDITOR_PROMPT.slice(0, 40))
    expect(complete.mock.calls[0][0].user).toContain('tighten the hero')
    expect(complete.mock.calls[0][0].user).toContain('--- Main.dc.html ---')
  })

  it('prefers an owner-edited prompt over the built-in default', async () => {
    const complete = vi.fn().mockResolvedValue(filesReply({ 'Main.dc.html': board() }))
    await editDesign({ complete, systemPrompt: 'OWNER PROMPT' }, { files: files(1), instruction: 'x' })
    expect(complete.mock.calls[0][0].system).toContain('OWNER PROMPT')
    expect(complete.mock.calls[0][0].system).not.toContain('You author and edit design canvases')
  })

  it('does not send image bytes to the model', async () => {
    const complete = vi.fn().mockResolvedValue(filesReply({ 'Main.dc.html': board() }))
    await editDesign({ complete }, { files: { ...files(1), 'logo.png': 'A'.repeat(500) }, instruction: 'x' })
    const user = complete.mock.calls[0][0].user as string
    expect(user).not.toContain('A'.repeat(100))
    expect(user).toContain('bytes of base64')
  })
})

describe('editDesign — the validator gate', () => {
  it('retries once with the validator output as feedback, and succeeds', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce(filesReply({ 'Main.dc.html': board('<i style="color: {{x}} ? a : b">t</i>') }))
      .mockResolvedValueOnce(filesReply({ 'Main.dc.html': board('<i style="color: {{c}}">t</i>') }))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'colour it' })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
    expect(complete.mock.calls[1][0].user).toContain('previous attempt was rejected')
    expect(complete.mock.calls[1][0].user).toContain('style-ternary'.replace('style-ternary', 'style attribute'))
  })

  it('gives up after the retry and reports the issues', async () => {
    const complete = vi.fn().mockResolvedValue(filesReply({ 'Main.dc.html': '<div>no root</div>' }))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'x' })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(2)
    expect(r.validation!.errors.map((e) => e.code)).toContain('missing-x-dc')
  })

  it('rejects a response with no JSON, then retries', async () => {
    const complete = vi.fn()
      .mockResolvedValueOnce('Sure, I would suggest a warmer palette.')
      .mockResolvedValueOnce(filesReply({ 'Main.dc.html': board() }))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'x' })
    expect(r.ok).toBe(true)
    expect(complete.mock.calls[1][0].user).toContain('did not return a JSON object')
  })

  it('rejects an unsafe file name from the model', async () => {
    const complete = vi.fn().mockResolvedValue(filesReply({ '../evil.dc.html': board() }))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'x' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('unsafe file name')
  })

  it('does not retry a transport failure', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('no provider configured'))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'x' })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(1)
    expect(complete).toHaveBeenCalledOnce()
    expect(r.message).toContain('no provider configured')
  })

  it('treats an empty response as a failure', async () => {
    const r = await editDesign({ complete: vi.fn().mockResolvedValue('   ') }, { files: files(1), instruction: 'x' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('returned nothing')
  })
})

describe('editDesign — per-artboard', () => {
  it('edits only the target file and leaves the rest byte-identical', async () => {
    const before = files(5)
    const complete = vi.fn().mockResolvedValue(fileReply('A2.dc.html', board('<b>only me</b>')))
    const r = await editDesign({ complete }, { files: before, instruction: 'bold it', targetFile: 'A2.dc.html' })
    expect(r.ok).toBe(true)
    expect(r.tier).toBe('per-artboard')
    expect(r.files!['A2.dc.html']).toContain('only me')
    expect(r.files!['A1.dc.html']).toBe(before['A1.dc.html'])
    expect(r.files!['Main.dc.html']).toBe(before['Main.dc.html'])
  })

  it('tells the model which single file to edit', async () => {
    const complete = vi.fn().mockResolvedValue(fileReply('Main.dc.html', board()))
    await editDesign({ complete }, { files: files(1), instruction: 'x', targetFile: 'Main.dc.html' })
    expect(complete.mock.calls[0][0].user).toContain('# Edit only this file\nMain.dc.html')
    expect(complete.mock.calls[0][0].system).toContain('"content": "<full file content>"')
  })

  it('refuses a response that edited the wrong file', async () => {
    const complete = vi.fn().mockResolvedValue(fileReply('Other.dc.html', board()))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'x', targetFile: 'Main.dc.html' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('was asked to edit')
  })

  it('still runs the whole-canvas validator on a single-file edit', async () => {
    const complete = vi.fn().mockResolvedValue(fileReply('Main.dc.html', '<div>no root</div>'))
    const r = await editDesign({ complete }, { files: files(1), instruction: 'x', targetFile: 'Main.dc.html' })
    expect(r.ok).toBe(false)
    expect(r.validation!.errors.map((e) => e.code)).toContain('missing-x-dc')
  })
})

describe('createDesignFromBrief', () => {
  it('produces a validated canvas from a brief', async () => {
    const complete = vi.fn().mockResolvedValue(filesReply({ 'Main.dc.html': board('<h1>Acme</h1>') }))
    const r = await createDesignFromBrief({ complete }, 'a calm landing page for Acme')
    expect(r.ok).toBe(true)
    expect(complete.mock.calls[0][0].user).toContain('a calm landing page for Acme')
  })

  it('fails cleanly when the model produces an invalid canvas', async () => {
    const r = await createDesignFromBrief({ complete: vi.fn().mockResolvedValue(filesReply({ 'Main.dc.html': '<p>x</p>' })) }, 'x')
    expect(r.ok).toBe(false)
  })
})

describe('createDesignCompletion', () => {
  function recordingProvider(id: string, seen: Array<{ provider: string; req: ModelRequest }>, text = 'designed'): AIProvider {
    return {
      id,
      name: id,
      async listModels() {
        return [{
          id: `${id}-model`, name: `${id}-model`, provider: id, contextWindow: 100000, maxOutputTokens: 8000,
          supportsTools: true, supportsImages: false, supportsStreaming: true,
        }]
      },
      async complete(req: ModelRequest): Promise<ModelResponse> {
        seen.push({ provider: id, req })
        return {
          id: 'r', provider: id, model: req.model ?? `${id}-model`,
          content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
        }
      },
      async *stream(): AsyncIterable<StreamEvent> {},
    }
  }

  it("sends one isolated, interactive request with the prompt in system and returns the text", async () => {
    const complete = vi.fn(async (_req: ModelRequest): Promise<ModelResponse> => ({
      id: 'r', provider: 'p', model: 'm',
      content: [{ type: 'text', text: 'part 1' }, { type: 'text', text: ' part 2' }],
      stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
    }))
    const designComplete = createDesignCompletion(() => ({ complete }))

    const text = await designComplete({ system: 'DESIGN RULES', user: 'make it bold' })

    expect(text).toBe('part 1 part 2')
    const req = complete.mock.calls[0][0]
    expect(req.isolated).toBe(true)
    expect(req.system).toBe('DESIGN RULES')
    expect(req.messages).toEqual([{ role: 'user', content: 'make it bold' }])
    expect(req.metadata?.origin).toBe('interactive')
    expect(req.tools).toBeUndefined()
    expect(req.maxTokens).toBe(8000)
    // No pin and no tier: the gateway binds it to the install default.
    expect(req.provider).toBeUndefined()
    expect(req.model).toBeUndefined()
    expect(req.metadata?.tier).toBeUndefined()
  })

  it('lands on the install default, whatever order the providers registered in', async () => {
    for (const order of [['alpha', 'zeta'], ['zeta', 'alpha']]) {
      const seen: Array<{ provider: string; req: ModelRequest }> = []
      const gateway = createModelGateway(undefined, { getDefault: () => ({ providerId: 'zeta', modelId: 'zeta-model' }) })
      for (const id of order) gateway.registerProvider(recordingProvider(id, seen))

      const text = await createDesignCompletion(() => gateway)({ system: 's', user: 'u' })

      expect(text).toBe('designed')
      expect(seen.map((s) => s.provider)).toEqual(['zeta'])
      expect(seen[0].req.model).toBe('zeta-model')
      expect(seen[0].req.isolated).toBe(true)
    }
  })

  it('reads the gateway per call, so a wrapper installed later is used', async () => {
    const first = { complete: vi.fn() }
    const later = {
      complete: vi.fn(async (): Promise<ModelResponse> => ({
        id: 'r', provider: 'p', model: 'm', content: [{ type: 'text', text: 'wrapped' }],
        stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
      })),
    }
    let current: { complete: (req: ModelRequest) => Promise<ModelResponse> } = first as any
    const designComplete = createDesignCompletion(() => current)
    current = later

    expect(await designComplete({ system: 's', user: 'u' })).toBe('wrapped')
    expect(first.complete).not.toHaveBeenCalled()
  })

  it('no default model: the call fails, and editDesign reports a failed run without a canvas', async () => {
    const gateway = createModelGateway(undefined, { getDefault: () => null })
    const designComplete = createDesignCompletion(() => gateway)

    await expect(designComplete({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'no_model_configured' })
    const r = await editDesign({ complete: designComplete }, { files: files(1), instruction: 'x' })
    expect(r.ok).toBe(false)
    expect(r.files).toBeUndefined()
  })
})
