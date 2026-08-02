// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Governance for Grok ACP server requests.
 *
 * Maps ACP permission requests and fs read/write servicing onto the same
 * canonical tool vocabulary the EYAS security gate already classifies for
 * the Claude Code provider (Bash=red, Write/Edit=yellow, ...), and answers
 * them fail-closed: no wired gate means no approval and no filesystem access.
 */

export type AcpPermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string }

/** Gate callback the provider builds from the shared permission bridge. */
export type AcpCanUseTool = (toolName: string, input: Record<string, unknown>) => Promise<AcpPermissionDecision>

export interface AcpToolCallInfo {
  toolCallId?: string
  kind?: string
  title?: string
  rawInput?: Record<string, unknown>
}

export interface AcpPermissionOption {
  optionId: string
  kind?: string
  name?: string
}

/**
 * ACP tool-call kind → canonical gate tool name. `delete` deliberately maps to
 * Bash (red tier): destructive calls must land on the strictest classification.
 */
const KIND_TO_TOOL: Record<string, string> = {
  execute: 'Bash',
  delete: 'Bash',
  edit: 'Write',
  move: 'Write',
  read: 'Read',
  search: 'Grep',
  fetch: 'WebFetch',
}

/** Reserved gate name for ACP tool calls whose kind has no canonical mapping.
 * Deliberately NOT a real tool name: the security gate treats unclassified
 * names as fail-closed (escalate), never green. */
export const ACP_UNMAPPED_TOOL = 'AcpUnmappedTool'

export function mapAcpToolCall(toolCall: AcpToolCallInfo): { name: string; input: Record<string, unknown>; mapped: boolean } {
  const mapped = toolCall.kind ? KIND_TO_TOOL[toolCall.kind] : undefined
  // kind/title are agent-controlled. The title must NEVER become the gate
  // name — a title colliding with a green-tier tool would self-classify the
  // call. Unmapped kinds resolve to the reserved name and escalate.
  return {
    name: mapped ?? ACP_UNMAPPED_TOOL,
    // Surface the raw kind/title to the LLM judge + audit log without
    // letting them influence classification.
    input: { ...(toolCall.rawInput ?? {}), _acp: { kind: toolCall.kind, title: toolCall.title } },
    mapped: Boolean(mapped),
  }
}

/**
 * Pick the ACP option matching the gate's verdict. Allows prefer *_once over
 * *_always: EYAS must stay the approver of every future call, so a standing
 * allow_always grant is never selected. No matching option → cancelled.
 */
export function chooseAcpOption(
  options: AcpPermissionOption[],
  behavior: 'allow' | 'deny',
): { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } {
  if (options.length === 0) return { outcome: 'cancelled' }

  const pick =
    behavior === 'allow'
      ? options.find((o) => o.kind === 'allow_once') ??
        options.find((o) => o.kind === 'allow_always') ??
        options.find((o) => /\b(allow|approve|yes)\b/i.test(o.name ?? o.optionId))
      : options.find((o) => o.kind === 'reject_once') ??
        options.find((o) => o.kind === 'reject_always') ??
        options.find((o) => /\b(reject|deny|no)\b/i.test(o.name ?? o.optionId))

  return pick ? { outcome: 'selected', optionId: pick.optionId } : { outcome: 'cancelled' }
}

export interface AcpServerHandlerDeps {
  /** Absent gate = fail-closed: every permission and fs request is refused. */
  canUseTool?: AcpCanUseTool
  respond: (id: number | string, result: unknown) => void
  respondError: (id: number | string, message: string) => void
  logger?: { warn?: (o: unknown, msg?: string) => void }
}

/**
 * Handles ACP server→client requests that carry authority (permissions, fs).
 * Returns true when the method was handled, false for anything else.
 */
export function createAcpServerHandler(deps: AcpServerHandlerDeps) {
  const { canUseTool, respond, respondError, logger } = deps

  const decide = async (name: string, input: Record<string, unknown>): Promise<AcpPermissionDecision> => {
    if (!canUseTool) {
      logger?.warn?.({ tool: name }, 'grok-cli ACP: no security gate wired — refusing (fail-closed)')
      return { behavior: 'deny', message: 'no security gate wired (fail-closed)' }
    }
    try {
      return await canUseTool(name, input)
    } catch (err) {
      return { behavior: 'deny', message: err instanceof Error ? err.message : String(err) }
    }
  }

  return async (method: string, id: number | string | null, params: any): Promise<boolean> => {
    if (method === 'session/request_permission') {
      if (id == null) return true
      const { name, input } = mapAcpToolCall((params?.toolCall ?? {}) as AcpToolCallInfo)
      const decision = await decide(name, input)
      respond(id, { outcome: chooseAcpOption((params?.options ?? []) as AcpPermissionOption[], decision.behavior) })
      return true
    }

    if (method === 'fs/read_text_file') {
      if (id == null) return true
      const path = params?.path as string
      const decision = await decide('Read', { path })
      if (decision.behavior === 'deny') {
        respondError(id, `fs read denied: ${decision.message}`)
        return true
      }
      try {
        const { readFile } = await import('node:fs/promises')
        const text = await readFile(path, 'utf8')
        const limit = params?.limit
        const content = typeof limit === 'number' ? text.split('\n').slice(0, limit).join('\n') : text
        respond(id, { content })
      } catch (err) {
        respondError(id, err instanceof Error ? err.message : String(err))
      }
      return true
    }

    if (method === 'fs/write_text_file') {
      if (id == null) return true
      const path = params?.path as string
      const content = (params?.content ?? '') as string
      const decision = await decide('Write', { path, content })
      if (decision.behavior === 'deny') {
        respondError(id, `fs write denied: ${decision.message}`)
        return true
      }
      try {
        const { writeFile, mkdir } = await import('node:fs/promises')
        const { dirname } = await import('node:path')
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf8')
        respond(id, {})
      } catch (err) {
        respondError(id, err instanceof Error ? err.message : String(err))
      }
      return true
    }

    return false
  }
}
