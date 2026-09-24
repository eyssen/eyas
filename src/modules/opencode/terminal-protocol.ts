// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { TerminalClientFrame, TerminalServerFrame } from './types.js'

export function encodeServerFrame(frame: TerminalServerFrame): string {
  return JSON.stringify(frame)
}

export function parseClientFrame(raw: string | Buffer): TerminalClientFrame | null {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { type: 'input', data: text }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const rec = parsed as Record<string, unknown>
  if (rec.type === 'ping') return { type: 'ping' }
  if (rec.type === 'input' && typeof rec.data === 'string') {
    if (rec.data.length > 32_768) return null
    return { type: 'input', data: rec.data }
  }
  if (rec.type === 'resize' && typeof rec.cols === 'number' && typeof rec.rows === 'number') {
    const cols = Math.trunc(rec.cols)
    const rows = Math.trunc(rec.rows)
    if (cols < 8 || cols > 400 || rows < 4 || rows > 200) return null
    return { type: 'resize', cols, rows }
  }
  return null
}
