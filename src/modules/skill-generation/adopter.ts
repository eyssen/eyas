// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { rm } from 'node:fs/promises'
import { generateId } from '@shared/crypto'
import type {
  ABResult,
  AdoptionAction,
  AdoptionEvent,
  GeneratedSkill,
  SkillRegistryPort,
} from './types.js'

/**
 * Adopter — Phase 3J.
 *
 * Reads an A/B result and a GeneratedSkill, and performs the follow-up:
 *
 *   - adopt:  register the skill through the registry port; record event.
 *   - reject: archive or discard the generated files; record event.
 *   - more-data: leave files in place, record event so an outer scheduler
 *     can enqueue a bigger experiment.
 *
 * The registry port is a placeholder — this module does NOT touch the real
 * skills module. The port is logged so operators can see what WOULD have
 * happened, and a later phase can wire up the true registration.
 *
 * Gated apply (Task 9 — safety-critical): 'adopt' is a self-improvement
 * apply (it registers a model-authored skill into the running system), so
 * per the autonomy invariant it must never fire without owner approval. When
 * `deps.approvalQueue` is supplied, an 'adopt' recommendation is ENQUEUED
 * (category 'skill.adopt') instead of registered immediately; the real
 * `registry.register()` call only happens via createSkillAdoptApplyHandler,
 * on owner approval. `approvalQueue` is optional only because no caller
 * wires this module's HTTP routes into the running system yet (see
 * routes.ts / index.ts) — whichever task wires them MUST supply it.
 */

export interface AdopterDeps {
  registry: SkillRegistryPort
  /**
   * Called when rejecting: by default we leave files in place (archive).
   * Pass `true` to physically delete the generated-skill folder.
   */
  deleteOnReject?: boolean
  /** Gates the 'adopt' path through the autonomy approval queue — see header comment. */
  approvalQueue?: SkillAdoptApprovalQueue
  now?: () => number
}

/** Narrow structural subset of AutonomyPolicy.createApproval — avoids importing the whole security-gate module for one method. */
export interface SkillAdoptApprovalQueue {
  createApproval(input: { category: string; preview?: string; reason?: string; inputJson?: string }): number
}

export interface AdoptionDecision {
  action: AdoptionAction
  event: AdoptionEvent
  /** Set when action === 'adopted'. */
  registeredSlug?: string
}

export function createAdopter(deps: AdopterDeps) {
  const now = deps.now ?? Date.now

  return {
    async process(skill: GeneratedSkill, result: ABResult): Promise<AdoptionDecision> {
      const ts = now()
      const alreadyRegistered = await deps.registry.isRegistered(skill.slug)
      if (alreadyRegistered) {
        const event: AdoptionEvent = {
          id: generateId(),
          candidateSkillId: skill.metadata.candidateId,
          experimentId: result.experimentId,
          action: 'noop-already-adopted',
          timestamp: ts,
          reason: `Skill ${skill.slug} is already registered; skipping`,
        }
        return { action: 'noop-already-adopted', event }
      }

      if (result.recommendation === 'adopt') {
        if (deps.approvalQueue) {
          deps.approvalQueue.createApproval({
            category: 'skill.adopt',
            preview: skill.skillMdContent,
            reason: `Adopt skill "${skill.slug}" (${result.note})`,
            inputJson: JSON.stringify({ skill, result }),
          })
          return {
            action: 'pending-approval',
            event: {
              id: generateId(),
              candidateSkillId: skill.metadata.candidateId,
              experimentId: result.experimentId,
              action: 'pending-approval',
              timestamp: ts,
              reason: result.note,
            },
          }
        }

        await deps.registry.register(skill)
        return {
          action: 'adopted',
          registeredSlug: skill.slug,
          event: {
            id: generateId(),
            candidateSkillId: skill.metadata.candidateId,
            experimentId: result.experimentId,
            action: 'adopted',
            timestamp: ts,
            reason: result.note,
          },
        }
      }

      if (result.recommendation === 'reject') {
        if (deps.deleteOnReject) {
          await rm(skill.directory, { recursive: true, force: true })
        }
        return {
          action: 'rejected',
          event: {
            id: generateId(),
            candidateSkillId: skill.metadata.candidateId,
            experimentId: result.experimentId,
            action: 'rejected',
            timestamp: ts,
            reason: result.note,
          },
        }
      }

      // more-data
      return {
        action: 'queued-more-data',
        event: {
          id: generateId(),
          candidateSkillId: skill.metadata.candidateId,
          experimentId: result.experimentId,
          action: 'queued-more-data',
          timestamp: ts,
          reason: result.note,
        },
      }
    },
  }
}

export type Adopter = ReturnType<typeof createAdopter>

/**
 * Apply-on-approval handler for category 'skill.adopt' — register on
 * autonomyPolicy via registerApplyHandler(). Runs the actual
 * `registry.register(skill)` that createAdopter's 'adopt' path deferred,
 * keyed off the `{skill, result}` payload stashed in the approval's
 * inputJson at gate time.
 */
export function createSkillAdoptApplyHandler(deps: { registry: SkillRegistryPort }) {
  return async (approval: { inputJson: string | null }): Promise<void> => {
    if (!approval.inputJson) return
    const { skill } = JSON.parse(approval.inputJson) as { skill: GeneratedSkill }
    const alreadyRegistered = await deps.registry.isRegistered(skill.slug)
    if (alreadyRegistered) return
    await deps.registry.register(skill)
  }
}
