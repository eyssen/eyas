// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The web API client carries the server's machine-readable error `code`
// (e.g. EFFORT_UNSUPPORTED, model_binding_unavailable) on ApiError, so a page
// can map it to a translated message instead of showing the English text.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

async function failure(): Promise<ApiError> {
  try {
    await api.patch('/conversations/c1', { effort: 'xhigh' })
  } catch (err) {
    return err as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('ApiError.code', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the code and the message from the error body (positive)', async () => {
    respond(400, { error: "Effort 'xhigh' is not supported", code: 'EFFORT_UNSUPPORTED', levels: ['low', 'high'] })
    const err = await failure()
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(400)
    expect(err.code).toBe('EFFORT_UNSUPPORTED')
    expect(err.message).toBe("Effort 'xhigh' is not supported")
  })

  it('no code, or a code that is not a string, leaves it undefined (negative)', async () => {
    respond(400, { error: 'Invalid effort' })
    expect((await failure()).code).toBeUndefined()
    respond(500, { error: 'boom', code: 42 })
    expect((await failure()).code).toBeUndefined()
  })
})
