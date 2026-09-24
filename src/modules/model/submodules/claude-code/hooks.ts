// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One place composes the Agent SDK hooks of a Claude Code query. Several
// contributors hook the same events (PreToolUse above all), and the SDK takes a
// single `hooks` record per query: a second writer would silently replace the
// first one's matchers — the memory-policy hook disappearing because an
// observer was installed after it is exactly the failure this prevents.
//
// Order is fixed, not caller-chosen: the deterministic memory-policy hook runs
// first, so its deny lands before any observer sees the call; then the effort
// readback. (The run tree is not a hook: the agent runner emits it for every
// provider from the stream.)

import type { HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeHookMap = Partial<Record<HookEvent, HookCallbackMatcher[]>>

/** One contributor's hooks. */
export interface ClaudeHookSet {
  hooks: ClaudeHookMap
  /** The contributor needs hook lifecycle messages in the output stream. */
  includeHookEvents?: boolean
}

/**
 * The contributors, one slot each:
 *   - sovereignty: the single deterministic memory-policy PreToolUse hook
 *                  (never the LLM judge — canUseTool already judges once);
 *   - readback:    the effective-effort readback.
 */
export interface ClaudeHookSlots {
  sovereignty?: ClaudeHookSet
  readback?: ClaudeHookSet
}

/** The order matchers of the same event run in. */
export const CLAUDE_HOOK_SLOT_ORDER = ['sovereignty', 'readback'] as const satisfies ReadonlyArray<keyof ClaudeHookSlots>

export interface MergedClaudeHooks {
  /** Absent when no slot contributed a matcher. */
  hooks?: ClaudeHookMap
  /** Set only when a slot that contributed matchers asked for it. */
  includeHookEvents?: true
}

/**
 * Concatenate the slots' per-event matcher arrays in CLAUDE_HOOK_SLOT_ORDER.
 * Inputs are never mutated; an empty slot or an empty event list adds nothing.
 */
export function mergeHooks(slots: ClaudeHookSlots): MergedClaudeHooks {
  const hooks: ClaudeHookMap = {}
  let includeHookEvents = false
  for (const slot of CLAUDE_HOOK_SLOT_ORDER) {
    const set = slots[slot]
    if (!set) continue
    let contributed = false
    for (const [event, matchers] of Object.entries(set.hooks) as Array<[HookEvent, HookCallbackMatcher[] | undefined]>) {
      if (!matchers || matchers.length === 0) continue
      ;(hooks[event] ??= []).push(...matchers)
      contributed = true
    }
    if (contributed && set.includeHookEvents) includeHookEvents = true
  }
  if (Object.keys(hooks).length === 0) return {}
  return includeHookEvents ? { hooks, includeHookEvents: true } : { hooks }
}

/** Options objects applyHooks has already written (even when nothing was contributed). */
const written = new WeakSet<object>()

/**
 * The only writer of `hooks` and `includeHookEvents` on a query's options.
 * Called once per query; a second call (or options that already carry hooks)
 * throws instead of replacing matchers someone else installed.
 */
export function applyHooks(queryOptions: Record<string, unknown>, slots: ClaudeHookSlots): void {
  if (written.has(queryOptions) || 'hooks' in queryOptions || 'includeHookEvents' in queryOptions) {
    throw new Error('claude-code: query hooks were already written — mergeHooks() is their only writer')
  }
  written.add(queryOptions)
  const merged = mergeHooks(slots)
  if (merged.hooks) queryOptions.hooks = merged.hooks
  if (merged.includeHookEvents) queryOptions.includeHookEvents = true
}
