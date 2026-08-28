// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

/**
 * Prompt-assembly reach contract.
 *
 * Before F0, four of roughly ten system-prompt entry points called the
 * assembler and the rest hand-rolled a `system` string, so anything the
 * assembler contributes — the project cascade, and from F1 the project brand —
 * silently missed delegated subagents and every channel reply.
 *
 * This test freezes the repair: each covered entry point must reach the
 * assembler, directly or through the shared helper. The debt baseline lists
 * the paths F0 knowingly leaves unassembled; shrinking it is welcome, growing
 * it must be a deliberate edit to this file.
 */

const root = resolve(__dirname, '../..')

/** Files that must reach the assembler. */
const COVERED_ENTRY_POINTS = [
  'src/modules/conversations/system-prompt.ts',
  'src/modules/agent/conversation-runner.ts',
  'src/modules/agent/orchestrator.ts',
  'src/modules/agent/delegated-system-prompt.ts',
  'src/modules/communication/channel-run-agent.ts',
]

/**
 * Known-unassembled paths. Each entry names why it is still hand-rolled.
 * FROZEN — do not add to this list without a written decision in the spec.
 */
const UNASSEMBLED_DEBT_BASELINE: Record<string, string> = {
  'src/modules/research/report-generator.ts': 'passes no system prompt at all; F3 changes the call site',
  'src/modules/model/submodules/claude-code/provider.ts': 'maps EYAS agents onto the SDK options.agents array; the SDK owns the subagent prompt',
}

const ASSEMBLY_MARKERS = [
  'buildForPrimary',
  'assembleSystemPrompt',
  'buildDelegatedSystemPrompt',
  'resolveConversationSystemPrompt',
]

function readIfPresent(rel: string): string | null {
  const p = resolve(root, rel)
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

describe('prompt assembly reach', () => {
  for (const rel of COVERED_ENTRY_POINTS) {
    it(`${rel} reaches the prompt assembler`, () => {
      const src = readIfPresent(rel)
      expect(src, `${rel} is missing — update COVERED_ENTRY_POINTS if it moved`).not.toBeNull()
      const hit = ASSEMBLY_MARKERS.some((m) => src!.includes(m))
      expect(hit, `${rel} builds a system prompt without touching the assembler. Route it through assembleSystemPrompt / buildDelegatedSystemPrompt.`).toBe(true)
    })
  }

  it('executeAgent no longer sends the bare agent definition prompt', () => {
    const src = readIfPresent('src/modules/agent/index.ts')
    expect(src).not.toBeNull()
    expect(src!).toContain('buildDelegatedSystemPrompt')
    expect(
      src!.includes("system: agentDef.systemPrompt || ''"),
      'executeAgent is back to the raw agent prompt — the assembler no longer reaches delegated subagents.',
    ).toBe(false)
  })

  it('the unassembled debt baseline has not grown', () => {
    expect(Object.keys(UNASSEMBLED_DEBT_BASELINE).sort()).toEqual([
      'src/modules/model/submodules/claude-code/provider.ts',
      'src/modules/research/report-generator.ts',
    ])
  })

  it('every debt entry still exists and still lacks assembly', () => {
    for (const rel of Object.keys(UNASSEMBLED_DEBT_BASELINE)) {
      const src = readIfPresent(rel)
      if (src === null) continue // file moved or was deleted; the baseline shrinks on the next edit
      const hit = ASSEMBLY_MARKERS.some((m) => src.includes(m))
      expect(hit, `${rel} now reaches the assembler — remove it from UNASSEMBLED_DEBT_BASELINE.`).toBe(false)
    }
  })

  it('the shared helper never throws by construction', () => {
    const src = readIfPresent('src/modules/prompt-wizard/assemble-system.ts')
    expect(src).not.toBeNull()
    expect(src!).toContain('catch')
    expect(src!).toContain('assemblerError')
  })

  it('the active-voice adapter swallows resolver failures', () => {
    const src = readIfPresent('src/modules/prompt-wizard/active-voice-adapter.ts')
    expect(src).not.toBeNull()
    expect(src!).toContain('catch')
    expect(src!).toContain('FALLBACK_VOICE_PROFILE')
  })
})
