import type {
  AgentOutput,
  BenchmarkTask,
  DeterministicCheck,
  JudgeFn,
  RubricScore,
  TaskResult,
} from './types.js'

/**
 * Deterministic checks — regex / keyword / cap enforcement. Failing any of
 * these is a hard gate: compositeScore is forced to zero and status = failed.
 */
export function runDeterministicChecks(
  task: BenchmarkTask,
  output: AgentOutput,
): DeterministicCheck[] {
  const checks: DeterministicCheck[] = []
  const text = output.text ?? ''
  const lower = text.toLowerCase()

  for (const kw of task.expectedOutcome.mustMentionKeywords ?? []) {
    checks.push({
      name: `must-mention:${kw}`,
      passed: lower.includes(kw.toLowerCase()),
      detail: `Keyword "${kw}" expected in output`,
    })
  }
  for (const kw of task.expectedOutcome.mustNotMention ?? []) {
    checks.push({
      name: `must-not-mention:${kw}`,
      passed: !lower.includes(kw.toLowerCase()),
      detail: `Keyword "${kw}" must NOT appear`,
    })
  }
  // NOTE: we intentionally do NOT compile task-provided patterns with `new RegExp`.
  // That would be a ReDoS risk (CWE-1333) and was flagged by our semgrep policy.
  // Instead, `mustMatchPhrases` uses case-insensitive substring matching, which
  // covers virtually all benchmark use cases without attacker-controlled regex.
  for (const phrase of task.expectedOutcome.mustMatchRegex ?? []) {
    checks.push({
      name: `phrase:${phrase}`,
      passed: lower.includes(phrase.toLowerCase()),
      detail: `Output must contain phrase "${phrase}" (case-insensitive substring)`,
    })
  }

  if (typeof task.maxTokens === 'number' && typeof output.tokensUsed === 'number') {
    checks.push({
      name: 'cap:maxTokens',
      passed: output.tokensUsed <= task.maxTokens,
      detail: `${output.tokensUsed} / ${task.maxTokens}`,
    })
  }
  if (typeof task.maxCostUsd === 'number' && typeof output.costUsd === 'number') {
    checks.push({
      name: 'cap:maxCostUsd',
      passed: output.costUsd <= task.maxCostUsd,
      detail: `${output.costUsd.toFixed(4)} / ${task.maxCostUsd}`,
    })
  }
  if (typeof task.maxDurationSec === 'number') {
    const durSec = output.durationMs / 1000
    checks.push({
      name: 'cap:maxDurationSec',
      passed: durSec <= task.maxDurationSec,
      detail: `${durSec.toFixed(2)}s / ${task.maxDurationSec}s`,
    })
  }
  return checks
}

/**
 * Build the judge prompt — strict rubric with explicit JSON schema. Exposed
 * for tests so we can assert the prompt is well-formed.
 */
export function buildJudgePrompt(
  task: BenchmarkTask,
  agentOutput: AgentOutput,
  promptUsed: string,
): { system: string; user: string } {
  const rubricLines = task.expectedOutcome.rubric
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n')
  const system = [
    'You are a strict benchmark judge. Evaluate the agent output against the rubric.',
    'Return ONLY valid JSON matching this shape:',
    '{"score": <0-100 integer>, "reasoning": "<short>", "perCriterion": [{"criterion": "<text>", "met": <bool>, "note": "<optional>"}]}',
    'Do not include markdown fences or prose outside the JSON.',
  ].join('\n')
  const user = [
    `# Task ID\n${task.id}`,
    `# Category\n${task.category}`,
    `# Prompt given to agent\n${promptUsed}`,
    `# Rubric\n${rubricLines}`,
    `# Agent output\n${agentOutput.text}`,
  ].join('\n\n')
  return { system, user }
}

/**
 * Parse a judge response string into a RubricScore. Tolerates minor wrapper
 * junk (e.g. markdown fences) but refuses unusable output.
 */
export function parseJudgeResponse(raw: string, rubric: string[]): RubricScore {
  let text = raw.trim()
  // Strip ```json ... ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]!.trim()
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return {
      score: 0,
      reasoning: `Judge returned unparseable response: ${raw.slice(0, 200)}`,
      perCriterion: rubric.map((c) => ({ criterion: c, met: false })),
    }
  }
  const o = obj as Record<string, unknown>
  const scoreRaw = typeof o.score === 'number' ? o.score : 0
  const score = Math.max(0, Math.min(100, Math.round(scoreRaw)))
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : ''
  const perCriterion = Array.isArray(o.perCriterion)
    ? (o.perCriterion as Array<Record<string, unknown>>).map((c) => ({
        criterion: typeof c.criterion === 'string' ? c.criterion : '',
        met: Boolean(c.met),
        note: typeof c.note === 'string' ? c.note : undefined,
      }))
    : rubric.map((c) => ({ criterion: c, met: false }))
  return { score, reasoning, perCriterion }
}

/**
 * Compose the final TaskResult. Deterministic gates short-circuit to zero.
 */
export function composeResult(args: {
  task: BenchmarkTask
  promptUsed: string
  output: AgentOutput
  deterministicChecks: DeterministicCheck[]
  rubric?: RubricScore
}): TaskResult {
  const { task, promptUsed, output, deterministicChecks, rubric } = args
  const hardFailed = deterministicChecks.some((c) => !c.passed)
  const rubricScore = rubric?.score ?? 0
  const composite = hardFailed ? 0 : rubricScore
  const status: TaskResult['status'] = hardFailed || composite < 70 ? 'failed' : 'passed'
  return {
    taskId: task.id,
    category: task.category,
    status,
    promptUsed,
    output,
    deterministicChecks,
    rubric,
    compositeScore: composite,
    timestamp: new Date().toISOString(),
  }
}

export type { JudgeFn }
