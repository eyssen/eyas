// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { OpencodeClient } from './opencode-client.js'
import { formatMemoryForPrompt, queryEyasMemory, saveEyasMemory, type MemoryServiceLike } from './memory-bridge.js'
import type { DeveloperTaskInput, DeveloperTaskResult, OpencodeEvent } from './types.js'

const DEFAULT_TIMEOUT_MS = 180_000

export interface DeveloperAgentDeps {
  getClient: () => Promise<OpencodeClient>
  getMemory: () => MemoryServiceLike | undefined
  logger: Logger
}

export function createDeveloperAgent(deps: DeveloperAgentDeps) {
  return {
    async run(input: DeveloperTaskInput): Promise<DeveloperTaskResult> {
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let sessionId: string | null = null
      try {
        const mem = await queryEyasMemory(deps.getMemory(), {
          query: input.prompt,
          conversationId: input.conversationId,
          projectId: input.projectId ?? null,
          limit: 8,
        })
        const quoted = 'error' in mem ? '' : formatMemoryForPrompt(mem.results)
        const client = await deps.getClient()
        const session = await client.createSession({
          title: input.prompt.slice(0, 80),
          directory: input.cwd,
        })
        sessionId = session.id

        if (quoted) {
          await client.prompt(session.id, {
            noReply: true,
            parts: [{ type: 'text', text: quoted }],
          })
        }

        const ac = new AbortController()
        const sub = client.subscribeEvents(ac.signal, (event: OpencodeEvent) => {
          const props = event.properties ?? {}
          if (event.type.includes('tool') || event.type.includes('message')) {
            const snippet = JSON.stringify(props).slice(0, 2_000)
            saveEyasMemory({
              content: snippet,
              conversationId: input.conversationId,
              projectId: input.projectId ?? null,
              kind: 'reasoning',
              meta: { opencodeSessionId: session.id, eventType: event.type },
            })
          }
        }).catch((err) => {
          deps.logger.debug({ err }, 'OpenCode event stream ended')
        })

        const timer = setTimeout(() => ac.abort(), timeoutMs)
        let text = ''
        try {
          const result = await client.prompt(session.id, {
            parts: [{ type: 'text', text: input.prompt }],
            model: input.model,
          })
          text = result.text
        } finally {
          clearTimeout(timer)
          ac.abort()
          await sub.catch(() => undefined)
        }

        const diffs = await client.diff(session.id).catch(() => [])
        if (diffs.length > 0) {
          saveEyasMemory({
            content: diffs.map((d) => `${d.path} +${d.additions}/-${d.deletions}`).join('\n'),
            conversationId: input.conversationId,
            projectId: input.projectId ?? null,
            kind: 'diff',
            meta: { opencodeSessionId: session.id },
          })
        }
        if (text) {
          saveEyasMemory({
            content: text,
            conversationId: input.conversationId,
            projectId: input.projectId ?? null,
            kind: 'reasoning',
            meta: { opencodeSessionId: session.id },
          })
        }
        return {
          ok: true,
          sessionId,
          summary: text || 'OpenCode finished with no text part.',
          diffs,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        deps.logger.warn({ err, sessionId }, 'OpenCode developer task failed')
        return { ok: false, sessionId, summary: '', diffs: [], error: message }
      }
    },
  }
}

export type DeveloperAgent = ReturnType<typeof createDeveloperAgent>
