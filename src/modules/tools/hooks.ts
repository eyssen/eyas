// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Universal tool hooks (P4) — PreToolUse / PostToolUse for every provider path
 * that goes through createToolExecutor. Model-agnostic replacement for
 * Claude-Code-only lifecycle hooks.
 */

import type { ToolContext, ToolImplementation } from './types.js'

export type ToolHookDecision = 'allow' | 'deny'

export interface PreToolUseEvent {
  toolName: string
  input: Record<string, unknown>
  tool: ToolImplementation
  ctx?: ToolContext
}

export interface PreToolUseResult {
  decision: ToolHookDecision
  /** Required when decision is deny */
  reason?: string
  /** Optional mutated input (e.g. path rewrite). */
  input?: Record<string, unknown>
}

export interface PostToolUseEvent {
  toolName: string
  input: Record<string, unknown>
  tool: ToolImplementation
  ctx?: ToolContext
  success: boolean
  durationMs: number
  error?: string
  /** Present when execute returned a result object */
  output?: Record<string, unknown>
}

export type PreToolUseHook = (event: PreToolUseEvent) => PreToolUseResult | Promise<PreToolUseResult>
export type PostToolUseHook = (event: PostToolUseEvent) => void | Promise<void>

export interface ToolHookRegistry {
  addPreToolUse(hook: PreToolUseHook): () => void
  addPostToolUse(hook: PostToolUseHook): () => void
  runPreToolUse(event: PreToolUseEvent): Promise<PreToolUseResult>
  runPostToolUse(event: PostToolUseEvent): Promise<void>
  list(): { pre: number; post: number }
}

/**
 * Built-in safety hooks that always apply (in addition to security-gate).
 */
export function createDefaultPreToolUseHooks(): PreToolUseHook[] {
  return [
    // Block writes to git internals / worktree metadata via file tools
    (event) => {
      if (!['write_file', 'edit_file', 'read_file'].includes(event.toolName)) {
        return { decision: 'allow' }
      }
      const path = String(event.input.path ?? '')
      if (/(^|[\\/])\.git([\\/]|$)/i.test(path)) {
        return { decision: 'deny', reason: 'refusing access to .git directory via file tools' }
      }
      return { decision: 'allow' }
    },
  ]
}

export function createToolHookRegistry(seedPre: PreToolUseHook[] = []): ToolHookRegistry {
  const pre: PreToolUseHook[] = [...seedPre]
  const post: PostToolUseHook[] = []

  return {
    addPreToolUse(hook) {
      pre.push(hook)
      return () => {
        const i = pre.indexOf(hook)
        if (i >= 0) pre.splice(i, 1)
      }
    },
    addPostToolUse(hook) {
      post.push(hook)
      return () => {
        const i = post.indexOf(hook)
        if (i >= 0) post.splice(i, 1)
      }
    },
    async runPreToolUse(event) {
      let input = event.input
      for (const hook of pre) {
        const result = await hook({ ...event, input })
        if (result.decision === 'deny') {
          return { decision: 'deny', reason: result.reason ?? 'blocked by PreToolUse hook' }
        }
        if (result.input) input = result.input
      }
      return { decision: 'allow', input }
    },
    async runPostToolUse(event) {
      for (const hook of post) {
        try {
          await hook(event)
        } catch {
          // Post hooks must never fail the tool result
        }
      }
    },
    list() {
      return { pre: pre.length, post: post.length }
    },
  }
}
