// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { createHash } from 'node:crypto'
import type { ParentSnapshot, AssembledPrompt } from './types.js'
import type { CascadeResult } from './project-context-loader.js'
import { CORE_IDENTITY } from './core-identity.js'
import { CORE_RULES } from './core-rules.js'
import { estimateTokens } from './token-budget.js'

export interface SubAgentPromptInput {
  subagentName: string
  delegatedTask: string
  outputAudience: 'parent' | 'external'
  parentSnapshot: ParentSnapshot
  cascade: CascadeResult
  runtime: { date: string; channel: string; os: string }
  childDepth: number
  maxSpawnDepth: number
}

function tag(name: string, content: string): string {
  if (!content.trim()) return ''
  return `<${name}>\n${content.trim()}\n</${name}>\n\n`
}

function renderDelegatedVoice(snap: ParentSnapshot): string {
  const p = snap.voiceProfile
  return [
    `When producing output for ${snap.name}: speak as you would to a peer.`,
    `When producing output for the original user/external party: use this exact voice profile (snapshotted from your originating agent at delegation time):`,
    `- Address: ${p.address}`,
    `- Tone: ${p.tone}`,
    `- Verbosity: ${p.verbosity}`,
    `- Directness: ${p.directness}`,
    `- Humor: ${p.humor}`,
    `- Emoji: ${p.emoji}`,
    p.blockedPhrases.length > 0 ? `- Blocked phrases: ${JSON.stringify(p.blockedPhrases)}` : '',
    p.signature.trim() ? `- Signature flair: ${p.signature.trim()}` : '',
  ].filter(Boolean).join('\n')
}

export function buildSubagentPrompt(input: SubAgentPromptInput): AssembledPrompt {
  const parts: string[] = []
  parts.push(tag('core-identity', CORE_IDENTITY))
  parts.push(tag('core-rules', CORE_RULES))

  if (input.cascade.projectTypeAgents || input.cascade.projectAgents) {
    const cascadeLines: string[] = []
    if (input.cascade.projectTypeAgents) cascadeLines.push(`<source name="project-type">\n${input.cascade.projectTypeAgents}\n</source>`)
    if (input.cascade.projectAgents) cascadeLines.push(`<source name="project">\n${input.cascade.projectAgents}\n</source>`)
    parts.push(tag('project-context', cascadeLines.join('\n')))
  }

  parts.push(tag('subagent-role', [
    `You are a subagent spawned by ${input.parentSnapshot.name} for a specific task.`,
    `You exist solely to handle: ${input.delegatedTask}`,
    `You are NOT ${input.parentSnapshot.name}. Don't try to be.`,
    input.childDepth < input.maxSpawnDepth
      ? 'You may spawn further sub-agents using `sessions_spawn` if the task warrants.'
      : 'You may NOT spawn further sub-agents (depth limit reached).',
  ].join('\n')))

  parts.push(tag('delegated-voice', renderDelegatedVoice(input.parentSnapshot)))

  parts.push(tag('task', input.delegatedTask))
  parts.push(tag('output-audience', `Your output will be delivered to: ${input.outputAudience}`))

  parts.push(tag('runtime', `- Date: ${input.runtime.date}\n- Channel: ${input.runtime.channel}\n- OS: ${input.runtime.os}`))

  const prefix = parts.join('').trimEnd() + '\n'
  const prefixHash = createHash('sha256').update(prefix).digest('hex')
  return {
    prefix,
    suffix: '',
    reminders: [],
    cacheBoundaryHint: prefix.length,
    prefixHash,
    tokenEstimate: { prefix: estimateTokens(prefix), suffix: 0, reminders: 0 },
  }
}
