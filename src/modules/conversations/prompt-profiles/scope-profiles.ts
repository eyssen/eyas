// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Scope-aware prompt coaches for durable EYAS base prompts:
 * - project / project-type operating briefs (cascade layer)
 * - agent systemPrompt (additional-instructions layer)
 *
 * Distinct from the conversation Prompt Enhancer (user-message refinement).
 */

export type PromptCoachScope = 'project' | 'project-type' | 'agent-system'

export interface ProjectCoachContext {
  name?: string | null
  description?: string | null
  typeName?: string | null
  /** Inherited type-level brief when writing a project prompt. */
  typePrompt?: string | null
  defaultAgentName?: string | null
}

export interface ProjectTypeCoachContext {
  name?: string | null
  description?: string | null
}

export interface AgentSystemCoachContext {
  name?: string | null
  role?: string | null
  goal?: string | null
  backstory?: string | null
  description?: string | null
  tier?: string | null
  agentType?: string | null
  model?: string | null
  tools?: string[] | null
  capabilities?: string[] | null
  constraints?: string[] | null
}

export type PromptCoachContext =
  | ProjectCoachContext
  | ProjectTypeCoachContext
  | AgentSystemCoachContext

export function isPromptCoachScope(value: unknown): value is PromptCoachScope {
  return value === 'project' || value === 'project-type' || value === 'agent-system'
}

const SHARED_WORKFLOW = `## Output format (mandatory)
1. If the draft goal is still ambiguous, ask at most 1–2 clarifying questions — never flood.
2. Propose a concrete ready-to-paste brief.
3. Silently score 1–10 on: role-fit (correct layer), clarity, actionability, no duplication of other layers, specificity.
4. If score < 8, revise once, then re-score.
5. End every convergent reply with:

<quality-check score="9" missing="">
Optional one-line note
</quality-check>
<final-prompt variant="recommended">
…ready-to-paste content only — no markdown fences unless the content itself needs them…
</final-prompt>

When the user asks for alternatives, emit two final-prompt blocks:
- variant="concise"
- variant="thorough"
with one quality-check.

## Style
- Reply in the user's language (follow their latest message).
- Be short. Value is the final brief, not lectures.
- NO tools. Text-only coaching.
- Do not invent secrets, API keys, or environment-specific paths the user did not provide.`

function formatContextBlock(label: string, lines: (string | null | undefined)[]): string {
  const body = lines.filter((l): l is string => Boolean(l && l.trim())).join('\n')
  if (!body) return ''
  return `## Known context (${label})\n${body}\n`
}

function listLine(label: string, items: string[] | null | undefined): string | null {
  if (!items || items.length === 0) return null
  return `- ${label}: ${items.join(', ')}`
}

function fieldLine(label: string, value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  return `- ${label}: ${value.trim()}`
}

export function buildProjectCoachSystemPrompt(ctx: ProjectCoachContext = {}): string {
  const context = formatContextBlock('project', [
    fieldLine('Project name', ctx.name),
    fieldLine('Description', ctx.description),
    fieldLine('Project type', ctx.typeName),
    fieldLine('Default agent', ctx.defaultAgentName),
    ctx.typePrompt?.trim()
      ? `- Project-type brief (inherited defaults — refine, do not paste wholesale):\n${ctx.typePrompt.trim()}`
      : null,
  ])

  return `You are an EYAS project operating-brief coach. The user is writing the **project-level prompt** that every conversation in this project inherits via the prompt cascade (project-type → project → conversation).

## What this layer is for
- Shared **domain context** for the whole project (what is being built / run, stack, conventions).
- **Done criteria**, quality bars, and recurring constraints for work in this project.
- Pointers to important docs/paths the agents should prefer.
- Project-specific do/don't rules that apply to **all agents** working here.

## What this layer is NOT for
- Agent personality, voice, or SOUL (lives on the agent).
- One-off task instructions (belongs in the conversation user message / conversation prompt).
- Global platform identity or core rules (locked master layer).
- Long essay — keep it scannable (rough target: 150–400 words).

## Recommended structure
\`\`\`
## Domain
…

## Conventions
…

## Success criteria
…

## Constraints / out of scope
…

## Key references
…
\`\`\`

Adapt section names if the project needs different headings; keep the same intent.

${context}
${SHARED_WORKFLOW}`
}

export function buildProjectTypeCoachSystemPrompt(ctx: ProjectTypeCoachContext = {}): string {
  const context = formatContextBlock('project type', [
    fieldLine('Type name', ctx.name),
    fieldLine('Description', ctx.description),
  ])

  return `You are an EYAS project-type brief coach. The user is writing the **project-type prompt** — defaults inherited by every project of this type, then refined by each project's own prompt.

## What this layer is for
- Reusable defaults for a **category of work** (e.g. Development, Research, Support).
- Shared conventions, quality bars, and constraints typical for that category.
- Guidance that should apply even before a specific project is customized.

## What this layer is NOT for
- One project's unique domain facts (put those on the project prompt).
- Agent persona / voice.
- One-off task instructions.

## Recommended structure
\`\`\`
## Type intent
…

## Default conventions
…

## Quality bar
…

## Common constraints
…
\`\`\`

Keep it generic enough to inherit cleanly (rough target: 120–300 words).

${context}
${SHARED_WORKFLOW}`
}

export function buildAgentSystemCoachSystemPrompt(ctx: AgentSystemCoachContext = {}): string {
  const context = formatContextBlock('agent', [
    fieldLine('Name', ctx.name),
    fieldLine('Role', ctx.role),
    fieldLine('Goal', ctx.goal),
    fieldLine('Backstory', ctx.backstory),
    fieldLine('Description', ctx.description),
    fieldLine('Tier', ctx.tier),
    fieldLine('Agent type', ctx.agentType),
    fieldLine('Model', ctx.model),
    listLine('Tools', ctx.tools ?? undefined),
    listLine('Capabilities', ctx.capabilities ?? undefined),
    listLine('Constraints', ctx.constraints ?? undefined),
  ])

  return `You are an EYAS agent system-prompt coach. The user is writing the agent's **systemPrompt** field, which becomes \`<additional-instructions>\` in the assembled runtime prompt — on top of core identity, core rules, IDENTITY.md, SOUL, project cascade, tools, and skills.

## What this layer is for
- Stable **operating protocol** for this agent: how it approaches work, decision habits, output format.
- Role-specific rules that are not already covered by goal/backstory/constraints fields.
- When to act vs ask, how to structure replies, domain methods.

## What this layer is NOT for
- Repeating core platform identity or generic "you are a helpful assistant".
- Project-wide domain facts (use project prompt).
- Voice/tone (SOUL / voice presets).
- IDENTITY.md content (mission, proactive duties, escalate/refuse) — different workspace file.
- One-off task details.

## Recommended structure
\`\`\`
## Role
One sentence: who this agent is when executing work.

## Operating protocol
1. …
2. …

## Output format
…

## Boundaries
…
\`\`\`

Guidelines:
- 200–600 words. Specific beats generic.
- Prefer positive instructions ("do X") over long ban lists.
- Align with goal/backstory/constraints already known — extend, don't restate.
- If goal/backstory are empty, still produce a solid systemPrompt; mention gaps briefly outside the final block if useful.

${context}
${SHARED_WORKFLOW}`
}

export function buildScopedCoachSystemPrompt(
  scope: PromptCoachScope,
  context: PromptCoachContext = {},
): string {
  switch (scope) {
    case 'project':
      return buildProjectCoachSystemPrompt(context as ProjectCoachContext)
    case 'project-type':
      return buildProjectTypeCoachSystemPrompt(context as ProjectTypeCoachContext)
    case 'agent-system':
      return buildAgentSystemCoachSystemPrompt(context as AgentSystemCoachContext)
  }
}

export function coachGoalDescription(scope: PromptCoachScope): string {
  return `prompt-coach:${scope}`
}

export function coachSessionTitle(scope: PromptCoachScope): string {
  switch (scope) {
    case 'project':
      return 'Project Prompt Coach'
    case 'project-type':
      return 'Project Type Prompt Coach'
    case 'agent-system':
      return 'Agent System Prompt Coach'
  }
}
