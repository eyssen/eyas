// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import pino from 'pino'
import { GmailListener } from '../../../../../src/modules/communication/providers/gmail/listener.js'
import type { GmailClient } from '../../../../../src/modules/communication/providers/gmail/gmail-client.js'
import type { SecretsStore } from '../../../../../src/modules/communication/providers/gmail/types.js'
import type { InboundEmail } from '../../../../../src/modules/communication/providers/email-common/types.js'

const logger = pino({ level: 'silent' })

function memorySecrets(initial: Record<string, string> = {}): SecretsStore {
  const m = new Map(Object.entries(initial))
  return {
    async get(k) { return m.get(k) },
    async set(k, v) { m.set(k, v) },
    async delete(k) { m.delete(k) },
  }
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A minimal fake that captures calls and returns queued responses. */
function makeFakeClient(): {
  client: GmailClient
  profileMock: ReturnType<typeof vi.fn>
  historyMock: ReturnType<typeof vi.fn>
  messageMock: ReturnType<typeof vi.fn>
} {
  const profileMock = vi.fn()
  const historyMock = vi.fn()
  const messageMock = vi.fn()
  const client = {
    getProfile: profileMock,
    listHistory: historyMock,
    getMessage: messageMock,
  } as unknown as GmailClient
  return { client, profileMock, historyMock, messageMock }
}

describe('GmailListener.reseedHistoryId', () => {
  it('stores the profile historyId under the configured secret key', async () => {
    const { client, profileMock } = makeFakeClient()
    profileMock.mockResolvedValue({ emailAddress: 'me@x', historyId: '42' })
    const secrets = memorySecrets()
    const listener = new GmailListener({
      client, secrets, historyIdSecretKey: 'gmail:historyId',
      onMessage: async () => {}, logger,
    })
    const id = await listener.reseedHistoryId()
    expect(id).toBe('42')
    expect(await secrets.get('gmail:historyId')).toBe('42')
  })
})

describe('GmailListener.tick', () => {
  it('fetches full message and delivers to handler for messagesAdded entries', async () => {
    const { client, historyMock, messageMock } = makeFakeClient()
    historyMock.mockResolvedValueOnce({
      historyId: '20',
      history: [{
        id: '20',
        messagesAdded: [{ message: { id: 'new-msg-1' } }],
      }],
    })
    messageMock.mockResolvedValueOnce({
      id: 'new-msg-1',
      internalDate: '1700000000000',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@b.c' },
          { name: 'To', value: 'me@x.y' },
          { name: 'Subject', value: 'Hello' },
          { name: 'Content-Type', value: 'text/plain; charset="utf-8"' },
        ],
        body: { data: b64url('body') },
      },
    })
    const delivered: InboundEmail[] = []
    const secrets = memorySecrets({ 'gmail:historyId': '10' })
    const listener = new GmailListener({
      client, secrets, historyIdSecretKey: 'gmail:historyId',
      onMessage: async (m) => { delivered.push(m) },
      logger,
    })
    await listener.tick()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].subject).toBe('Hello')
    expect(await secrets.get('gmail:historyId')).toBe('20')
  })

  it('paginates through historyList using nextPageToken', async () => {
    const { client, historyMock, messageMock } = makeFakeClient()
    historyMock
      .mockResolvedValueOnce({
        historyId: '50',
        history: [{ id: '45', messagesAdded: [{ message: { id: 'msg-a' } }] }],
        nextPageToken: 'p2',
      })
      .mockResolvedValueOnce({
        historyId: '50',
        history: [{ id: '50', messagesAdded: [{ message: { id: 'msg-b' } }] }],
      })
    messageMock.mockResolvedValue({
      id: 'x',
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'a@b.c' },
          { name: 'To', value: 'me@x.y' },
          { name: 'Subject', value: 's' },
          { name: 'Content-Type', value: 'text/plain' },
        ],
        body: { data: b64url('x') },
      },
    })
    const delivered: InboundEmail[] = []
    const secrets = memorySecrets({ 'gmail:historyId': '40' })
    const listener = new GmailListener({
      client, secrets, historyIdSecretKey: 'gmail:historyId',
      onMessage: async (m) => { delivered.push(m) }, logger,
    })
    await listener.tick()
    expect(historyMock).toHaveBeenCalledTimes(2)
    expect(historyMock.mock.calls[1][0]).toMatchObject({ pageToken: 'p2' })
    expect(delivered).toHaveLength(2)
    expect(await secrets.get('gmail:historyId')).toBe('50')
  })

  it('reseeds when no historyId is stored yet', async () => {
    const { client, profileMock, historyMock } = makeFakeClient()
    profileMock.mockResolvedValue({ emailAddress: 'me@x', historyId: '100' })
    const secrets = memorySecrets()
    const listener = new GmailListener({
      client, secrets, historyIdSecretKey: 'gmail:historyId',
      onMessage: async () => {}, logger,
    })
    await listener.tick()
    expect(await secrets.get('gmail:historyId')).toBe('100')
    expect(historyMock).not.toHaveBeenCalled()
  })

  it('continues on per-message fetch failure', async () => {
    const { client, historyMock, messageMock } = makeFakeClient()
    historyMock.mockResolvedValueOnce({
      historyId: '20',
      history: [{
        id: '20',
        messagesAdded: [
          { message: { id: 'broken' } },
          { message: { id: 'ok' } },
        ],
      }],
    })
    messageMock.mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        id: 'ok',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'a@b.c' },
            { name: 'To', value: 'me@x.y' },
            { name: 'Subject', value: 'ok' },
            { name: 'Content-Type', value: 'text/plain' },
          ],
          body: { data: b64url('ok') },
        },
      })
    const delivered: InboundEmail[] = []
    const secrets = memorySecrets({ 'gmail:historyId': '10' })
    const listener = new GmailListener({
      client, secrets, historyIdSecretKey: 'gmail:historyId',
      onMessage: async (m) => { delivered.push(m) }, logger,
    })
    await listener.tick()
    expect(delivered.map((d) => d.subject)).toEqual(['ok'])
  })
})

describe('GmailListener.start/stop', () => {
  it('schedules ticks on the injected interval and stops cleanly', async () => {
    const { client, historyMock } = makeFakeClient()
    historyMock.mockResolvedValue({ historyId: '10', history: [] })
    const secrets = memorySecrets({ 'gmail:historyId': '5' })

    let intervalFn: (() => void) | null = null
    const setIntervalImpl = vi.fn((fn: () => void, _ms: number) => {
      intervalFn = fn
      return 123
    })
    const clearIntervalImpl = vi.fn()

    const listener = new GmailListener({
      client, secrets, historyIdSecretKey: 'gmail:historyId',
      onMessage: async () => {}, logger,
      setIntervalImpl, clearIntervalImpl,
    })
    const stop = await listener.start()
    expect(setIntervalImpl).toHaveBeenCalledTimes(1)
    expect(intervalFn).not.toBeNull()
    await stop()
    expect(clearIntervalImpl).toHaveBeenCalledWith(123)
  })

  it('throws when start is called twice', async () => {
    const { client, historyMock } = makeFakeClient()
    historyMock.mockResolvedValue({ historyId: '10', history: [] })
    const secrets = memorySecrets({ 'gmail:historyId': '5' })
    const listener = new GmailListener({
      client, secrets, historyIdSecretKey: 'gmail:historyId',
      onMessage: async () => {}, logger,
      setIntervalImpl: () => 1,
      clearIntervalImpl: () => {},
    })
    await listener.start()
    await expect(listener.start()).rejects.toThrow(/already running/)
  })
})
