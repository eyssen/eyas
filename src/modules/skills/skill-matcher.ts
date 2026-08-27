// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Skill, SkillMatch } from './types.js'

/** Weight multipliers for different match sources */
const WEIGHTS = {
  triggerPattern: 1.0,
  operationName: 0.8,
  functionName: 0.8,
  operationDescription: 0.6,
  functionDescription: 0.6,
  name: 0.5,
  description: 0.3,
  category: 0.4,
} as const

/**
 * Check if query contains a substring (case-insensitive) and return
 * a raw score based on the length ratio.
 */
function substringScore(query: string, candidate: string): number {
  const candidateLower = candidate.toLowerCase()
  if (query.includes(candidateLower)) {
    return candidateLower.length / query.length
  }
  return 0
}

/**
 * Check word overlap between query and a multi-word string.
 * Returns ratio of matched words to total words.
 */
function wordOverlapScore(query: string, text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1)
  if (words.length === 0) return 0
  const matched = words.filter(w => query.includes(w))
  return matched.length > 0 ? matched.length / words.length : 0
}

export function createSkillMatcher() {
  return {
    match(query: string, skills: Skill[], maxResults: number = 3): SkillMatch[] {
      const queryLower = query.toLowerCase()
      const matches: SkillMatch[] = []

      for (const skill of skills) {
        if (!skill.enabled) continue
        let bestScore = 0
        let bestPattern = ''

        // 1. Trigger pattern matching (weight: 1.0)
        for (const pattern of skill.triggerPatterns) {
          const score = substringScore(queryLower, pattern) * WEIGHTS.triggerPattern
          if (score > bestScore) {
            bestScore = score
            bestPattern = pattern
          }
        }

        // 2. Integration operations matching (weight: 0.8 name, 0.6 description)
        if (skill.integrationConfig?.operations) {
          for (const op of skill.integrationConfig.operations) {
            // Operation name
            const nameScore = substringScore(queryLower, op.name.replace(/_/g, ' ')) * WEIGHTS.operationName
            if (nameScore > bestScore) {
              bestScore = nameScore
              bestPattern = `operation: ${op.name}`
            }
            // Also check raw name (with underscores)
            const rawNameScore = substringScore(queryLower, op.name) * WEIGHTS.operationName
            if (rawNameScore > bestScore) {
              bestScore = rawNameScore
              bestPattern = `operation: ${op.name}`
            }
            // Operation description
            if (op.description) {
              const descScore = wordOverlapScore(queryLower, op.description) * WEIGHTS.operationDescription
              if (descScore > bestScore) {
                bestScore = descScore
                bestPattern = `operation_desc: ${op.name}`
              }
            }
          }
        }

        // 3. Tool functions matching (weight: 0.8 name, 0.6 description)
        if (skill.toolConfig?.functions) {
          for (const fn of skill.toolConfig.functions) {
            // Function name
            const nameScore = substringScore(queryLower, fn.name.replace(/_/g, ' ')) * WEIGHTS.functionName
            if (nameScore > bestScore) {
              bestScore = nameScore
              bestPattern = `function: ${fn.name}`
            }
            const rawNameScore = substringScore(queryLower, fn.name) * WEIGHTS.functionName
            if (rawNameScore > bestScore) {
              bestScore = rawNameScore
              bestPattern = `function: ${fn.name}`
            }
            // Function description
            if (fn.description) {
              const descScore = wordOverlapScore(queryLower, fn.description) * WEIGHTS.functionDescription
              if (descScore > bestScore) {
                bestScore = descScore
                bestPattern = `function_desc: ${fn.name}`
              }
            }
          }
        }

        // 4. Category matching (weight: 0.4)
        if (skill.category) {
          const categoryParts = skill.category.toLowerCase().split('/')
          for (const part of categoryParts) {
            if (queryLower.includes(part) && part.length > 1) {
              const score = (part.length / queryLower.length) * WEIGHTS.category
              if (score > bestScore) {
                bestScore = score
                bestPattern = `category: ${skill.category}`
              }
            }
          }
        }

        // 5. Skill name matching (weight: 0.5)
        if (bestScore === 0 || bestScore < 0.3) {
          const nameWords = skill.name.toLowerCase().split(/\s+/)
          const matchedWords = nameWords.filter(w => queryLower.includes(w) && w.length > 1)
          if (matchedWords.length > 0) {
            const score = (matchedWords.length / nameWords.length) * WEIGHTS.name
            if (score > bestScore) {
              bestScore = score
              bestPattern = `name: ${skill.name}`
            }
          }
        }

        // 6. Description matching (weight: 0.3)
        if (skill.description && (bestScore === 0 || bestScore < 0.2)) {
          const descScore = wordOverlapScore(queryLower, skill.description) * WEIGHTS.description
          if (descScore > bestScore) {
            bestScore = descScore
            bestPattern = `description: ${skill.description.substring(0, 50)}`
          }
        }

        if (bestScore > 0.1) {
          matches.push({ skill, matchScore: bestScore, matchedPattern: bestPattern })
        }
      }

      return matches.sort((a, b) => b.matchScore - a.matchScore).slice(0, maxResults)
    },
  }
}
