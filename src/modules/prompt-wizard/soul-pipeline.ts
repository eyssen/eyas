// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { WorkspaceWriter } from './workspace-writer.js'
import type { SoulStyleParsed } from './soul-style-schema.js'
import { renderSoulMd } from './soul-renderer.js'
import { soulStyleSchema } from './soul-style-schema.js'

export interface SoulPipelineDeps {
  writer: WorkspaceWriter
}

export interface SoulPipeline {
  /**
   * Validate, persist SOUL.style.json, and render SOUL.md.
   * Both files written atomically.
   */
  saveStyle(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void>

  /**
   * Re-render SOUL.md from an already-validated style without rewriting the JSON.
   * Used when only the agent name changed (e.g. rename) or for cache-invalidation flush.
   */
  rerender(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void>
}

export function createSoulPipeline(deps: SoulPipelineDeps): SoulPipeline {
  async function saveStyle(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void> {
    const validated = soulStyleSchema.parse(style) // throws on invalid
    await deps.writer.write({
      agentId,
      file: 'SOUL.style.json',
      body: JSON.stringify(validated, null, 2),
      skipFrontmatter: true,
    })
    const md = renderSoulMd(validated, agentName)
    await deps.writer.write({
      agentId,
      file: 'SOUL.md',
      body: md,
    })
  }

  async function rerender(agentId: string, agentName: string, style: SoulStyleParsed): Promise<void> {
    const md = renderSoulMd(style, agentName)
    await deps.writer.write({ agentId, file: 'SOUL.md', body: md })
  }

  return { saveStyle, rerender }
}
