// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { WorkingMemoryBlock, MemorySearchResult, ContextBuildResult, ContextSource } from '../types.js'

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function buildContext(
  workingBlocks: WorkingMemoryBlock[],
  searchResults: MemorySearchResult[],
  tokenBudget: number,
): ContextBuildResult {
  let tokensUsed = 0
  const sources: ContextSource[] = []
  const included: MemorySearchResult[] = []

  for (const block of workingBlocks) {
    const blockTokens = Math.min(estimateTokens(block.content), block.maxTokens)
    tokensUsed += blockTokens
    sources.push({ tier: 'working', id: block.key, tokens: blockTokens })
  }

  const sorted = [...searchResults].sort((a, b) => b.score - a.score)

  for (const result of sorted) {
    const resultTokens = estimateTokens(result.content)
    if (tokensUsed + resultTokens > tokenBudget) {
      const remaining = tokenBudget - tokensUsed
      if (remaining > 50) {
        const truncatedContent = result.content.slice(0, remaining * 4)
        included.push({ ...result, content: truncatedContent })
        sources.push({ tier: result.source, id: result.id, tokens: remaining })
        tokensUsed += remaining
      }
      break
    }
    included.push(result)
    sources.push({ tier: result.source, id: result.id, tokens: resultTokens })
    tokensUsed += resultTokens
  }

  return {
    workingBlocks,
    relevantMemories: included,
    totalTokens: tokensUsed,
    sources,
  }
}
