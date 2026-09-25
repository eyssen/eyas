// Benchmark harness types — Phase 4F
// Internal regression benchmark for EYAS workloads.
// All interfaces are MIT-compatible, TypeScript strict, ESM.

export type BenchmarkCategory =
  | 'email-triage'
  | 'coding'
  | 'ops'
  | 'research'
  | 'meetings'

export interface ExpectedOutcome {
  /** Optional canonical action label (e.g. "quick-reply", "escalate", "ignore") */
  action?: string
  /** Keywords that MUST appear in the agent output (case-insensitive substring match) */
  mustMentionKeywords?: string[]
  /** Keywords that MUST NOT appear in the agent output */
  mustNotMention?: string[]
  /**
   * Phrases the output must contain (case-insensitive substring match).
   * The field name is kept as `mustMatchRegex` for backward compatibility with
   * the design spec, but we do NOT compile patterns via `new RegExp` to avoid
   * ReDoS risk. Treat each entry as a literal phrase.
   */
  mustMatchRegex?: string[]
  /** Rubric lines fed to the LLM judge */
  rubric: string[]
}

export interface BenchmarkTask {
  id: string
  category: BenchmarkCategory
  prompt: string
  /** Semantically equivalent rewrites. Runner picks one at random per run. */
  promptVariations?: string[]
  /** Arbitrary structured context (emails, code snippets, cluster state, etc.) */
  context?: Record<string, unknown>
  expectedOutcome: ExpectedOutcome
  maxTokens?: number
  maxCostUsd?: number
  maxDurationSec?: number
  /** Freeform tags for filtering */
  tags?: string[]
}

export interface AgentInvocation {
  prompt: string
  context?: Record<string, unknown>
  task: BenchmarkTask
}

export interface AgentOutput {
  text: string
  tokensUsed?: number
  costUsd?: number
  durationMs: number
  /** Optional raw response for debugging */
  raw?: unknown
}

export interface Agent {
  run(invocation: AgentInvocation): Promise<AgentOutput>
}

export type AgentFactory = () => Agent

export interface DeterministicCheck {
  name: string
  passed: boolean
  detail?: string
}

export interface RubricScore {
  /** 0-100 */
  score: number
  reasoning: string
  perCriterion: Array<{ criterion: string; met: boolean; note?: string }>
}

export type TaskStatus = 'passed' | 'failed' | 'errored'

export interface TaskResult {
  taskId: string
  category: BenchmarkCategory
  status: TaskStatus
  promptUsed: string
  output?: AgentOutput
  deterministicChecks: DeterministicCheck[]
  rubric?: RubricScore
  /** Composite 0-100. Zero if any hard gate failed. */
  compositeScore: number
  error?: string
  timestamp: string
}

export interface RunSummary {
  passed: number
  failed: number
  errored: number
  avgScore: number
  totalCostUsd: number
  totalDurationMs: number
  tasksAttempted: number
  regressionDeltaPoints?: number
}

export interface RunOptions {
  categories?: BenchmarkCategory[]
  taskIds?: string[]
  /** Include held-out set for gaming-detection. Default false; enable on releases. */
  includeHeldOut?: boolean
  agentFactory: AgentFactory
  parallelism?: number
  /** Optional seeded RNG for reproducible variation picking */
  seed?: number
  /** Optional custom tasks directory (defaults to ./tasks relative to harness) */
  tasksDir?: string
  /** Optional held-out directory override */
  heldOutDir?: string
  /** Optional reports directory override */
  reportsDir?: string
  /** Inject a judge function for tests (defaults to model-gateway backed judge) */
  judge?: JudgeFn
  /** If true, skip writing report files (useful in tests) */
  skipReportWrite?: boolean
  /** Previous composite average for regression delta */
  previousAvgScore?: number
}

export interface RunResult {
  tasks: TaskResult[]
  summary: RunSummary
  reportPath?: string
  markdownReportPath?: string
  startedAt: string
  finishedAt: string
}

/** Judge signature — allows injecting a mock in tests */
export type JudgeFn = (args: {
  task: BenchmarkTask
  agentOutput: AgentOutput
  promptUsed: string
}) => Promise<RubricScore>

/** Pseudo-random generator interface (deterministic when seeded) */
export interface Rng {
  next(): number
  pick<T>(items: readonly T[]): T
}
