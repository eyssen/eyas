// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { capToolResultContent, toolResultText, TOOL_RESULT_CONTENT_CAP_BYTES } from '@modules/model/tool-result-content.js'

describe('toolResultText — one tool output as flat text', () => {
  it('keeps a string, joins text blocks and marks images/documents (positive)', () => {
    expect(toolResultText('plain')).toBe('plain')
    expect(toolResultText([
      { type: 'text', text: 'line one' },
      { type: 'image', source: { type: 'base64', data: 'AAAA' } },
      { type: 'document', source: {} },
      { type: 'text', text: 'line two' },
    ])).toBe('line one\n[image]\n[document]\nline two')
  })

  it('serializes an unknown block or a structured output instead of dropping it', () => {
    expect(toolResultText([{ type: 'tool_reference', tool_name: 'x' }])).toBe('{"type":"tool_reference","tool_name":"x"}')
    expect(toolResultText({ ok: true })).toBe('{"ok":true}')
  })

  it('absent output is empty; an image never leaks its bytes (negative)', () => {
    expect(toolResultText(undefined)).toBe('')
    expect(toolResultText(null)).toBe('')
    expect(toolResultText([{ type: 'image', source: { data: 'SECRETBYTES' } }])).not.toContain('SECRETBYTES')
  })
})

describe('capToolResultContent — bounded to 64 KiB of UTF-8', () => {
  it('leaves a text within the cap untouched (negative)', () => {
    const text = 'a'.repeat(TOOL_RESULT_CONTENT_CAP_BYTES)
    expect(capToolResultContent(text)).toBe(text)
  })

  it('cuts a longer text, keeps its head and says how much was cut (positive)', () => {
    const out = capToolResultContent('b'.repeat(TOOL_RESULT_CONTENT_CAP_BYTES + 10))
    expect(out.startsWith('b'.repeat(TOOL_RESULT_CONTENT_CAP_BYTES))).toBe(true)
    expect(out).toMatch(/truncated: 10 of 65546 bytes not shown/)
  })

  it('never splits a multi-byte character', () => {
    const out = capToolResultContent('é'.repeat(10), 5) // 2 bytes each: the cut lands mid-character
    expect(out.startsWith('éé\n')).toBe(true)
    expect(out).not.toContain('�')
  })
})
