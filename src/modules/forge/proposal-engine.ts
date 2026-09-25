// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Logger } from 'pino'
import type { FrictionPattern, ForgeProposal, ForgeScope } from './types.js'
import type { createProposalStore } from './proposal-store.js'
import type { AuxiliaryModelService } from '@modules/model/auxiliary.js'

type ProposalStore = ReturnType<typeof createProposalStore>

export interface ProposalEngineDeps {
  toolRegistry?: { get(name: string): { name: string; description: string } | undefined }
  skillRegistry?: { get(id: string): { id: string; name: string; description: string; content: string } | undefined }
  /**
   * The background model service (purpose 'forge') — authors proposedValue
   * from the target's current description + raw friction samples. Read at
   * call time (forge/index.ts wires it as a getter). No eligible model or a
   * failed call falls back to the string-concat below; never throws.
   */
  aux?: Pick<AuxiliaryModelService, 'completeText'>
  logger?: Logger
}

export function createProposalEngine(store: ProposalStore, deps: ProposalEngineDeps) {
  return {
    /**
     * `modelPassEnabled` is the `forge.apply` Phase-3 loop feature flag
     * (security-gate/autonomy-features.ts), read FRESH by the caller
     * (forge/index.ts's runScan) at fire time and passed in here. Defaults to
     * `true` so existing callers/tests that predate the flag are unaffected.
     * `false` skips the model pass, falling back to the string-concat (same
     * shape as a missing model).
     */
    async generateFromFriction(pattern: FrictionPattern, modelPassEnabled: boolean = true): Promise<ForgeProposal[]> {
      const proposals: ForgeProposal[] = []
      const scope: ForgeScope = 'description'
      if (store.hasPending(pattern.target, pattern.targetId, scope)) return proposals

      let currentValue = ''
      if (pattern.target === 'tool' && deps.toolRegistry) {
        const tool = deps.toolRegistry.get(pattern.targetId)
        currentValue = tool?.description ?? ''
      } else if (pattern.target === 'skill' && deps.skillRegistry) {
        const skill = deps.skillRegistry.get(pattern.targetId)
        currentValue = skill?.description ?? ''
      }

      const topFriction = pattern.topFrictions[0] ?? 'unknown friction'
      const topSuggestion = pattern.topSuggestions[0]
      const confidence = Math.min(pattern.frictionCount / 20, 0.9)

      // The pre-authoring behaviour — also the background call's fallback, so
      // no eligible model or a failed call reproduces it exactly (fail-open).
      const concatFallback = topSuggestion
        ? `${currentValue}. Note: ${topSuggestion}`
        : `${currentValue}. Common issue: ${topFriction} — consider alternatives when this occurs.`

      const aux = deps.aux
      const proposedValue = modelPassEnabled && aux
        ? await aux.completeText({
            purpose: 'forge',
            system:
              'You are improving the description of an EYAS tool/skill so agents pick it up correctly ' +
              'and avoid known usage friction. Rewrite it into ONE improved description (1-3 sentences, ' +
              'no preamble, no quotes) that keeps the original intent but addresses the friction below.',
            user: `Current description: ${currentValue || '(none)'}\nReported friction:\n${pattern.topFrictions.map((f) => `- ${f}`).join('\n')}`,
            maxTokens: 200,
            temperature: 0.4,
            fallback: concatFallback,
          })
        : concatFallback

      // betterApproach/topSuggestions is read here but, in practice, almost
      // never written (nothing in the pipeline records it — see
      // friction-analyzer.ts). Reuse the just-authored text as that
      // suggestion when none was ever recorded, instead of spending a second
      // model call just to fill it in.
      const betterApproach = topSuggestion ?? (proposedValue !== concatFallback ? proposedValue : undefined)

      const proposal = store.add({
        target: pattern.target, targetId: pattern.targetId, scope,
        title: `Improve ${pattern.targetId} description — ${topFriction}`,
        description: `${pattern.frictionCount}/${pattern.totalUsages} usages reported friction. Top issue: ${topFriction}.`,
        currentValue, proposedValue,
        reasoning: `Friction rate ${(pattern.frictionRate * 100).toFixed(0)}% over ${pattern.totalUsages} usages. Top frictions: ${pattern.topFrictions.join(', ')}. ${betterApproach ? `Suggested: ${betterApproach}` : ''}`,
        confidence, basedOnFeedbacks: pattern.frictionCount,
      })
      proposals.push(proposal)
      return proposals
    },
  }
}
