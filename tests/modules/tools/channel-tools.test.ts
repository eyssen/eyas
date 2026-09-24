// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createChannelTools } from '@modules/tools/builtin/channel-tools.js'

describe('channel tools', () => {
  it('list_channels returns router snapshot', async () => {
    const tools = createChannelTools({
      getRouter: () =>
        ({
          listChannels: () => [
            { id: 'telegram', type: 'telegram', name: 'Telegram', connected: true },
          ],
          getChannel: () => undefined,
        }) as any,
    })
    const list = tools.find((t) => t.name === 'list_channels')!
    const res = await list.execute({})
    expect(res).toEqual({
      channels: [{ id: 'telegram', type: 'telegram', name: 'Telegram', connected: true }],
    })
  })

  it('channel_send delivers via channel.send', async () => {
    const send = vi.fn(async () => {})
    const tools = createChannelTools({
      getRouter: () =>
        ({
          listChannels: () => [{ id: 'telegram', type: 'telegram', name: 'TG', connected: true }],
          getChannel: (id: string) =>
            id === 'telegram' ? { connected: true, send } : undefined,
        }) as any,
    })
    const sendTool = tools.find((t) => t.name === 'channel_send')!
    const res = await sendTool.execute({
      channelId: 'telegram',
      target: '123',
      text: 'hi',
    })
    expect(res).toEqual({ ok: true, channelId: 'telegram', target: '123' })
    expect(send).toHaveBeenCalledWith('123', { text: 'hi' })
  })

  it('channel_send fails when channel missing', async () => {
    const tools = createChannelTools({
      getRouter: () =>
        ({
          listChannels: () => [],
          getChannel: () => undefined,
        }) as any,
    })
    const sendTool = tools.find((t) => t.name === 'channel_send')!
    const res = (await sendTool.execute({
      channelId: 'telegram',
      target: '1',
      text: 'x',
    })) as any
    expect(res.error).toMatch(/not found/i)
  })
})
