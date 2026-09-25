/**
 * CI entry point for the internal benchmark harness.
 *
 * Flags:
 *   --held-out             include the held-out set
 *   --category=<name>      restrict to one category (repeatable)
 *   --task=<id>            restrict to specific task IDs (repeatable)
 *   --stub                 force empty agent + stub judge (pure plumbing smoke)
 *
 * Default (Wave 1): category-aware EYAS agent factory (email classifier +
 * structured heuristics). Set EYAS_BENCH_LIVE=1 for HTTP against a running server.
 */

import { createBenchmarkRunner } from '../runner/benchmark-runner.js'
import { createEyasAgentFactory } from '../runner/eyas-agent-factory.js'
import type {
  Agent,
  AgentInvocation,
  AgentOutput,
  BenchmarkCategory,
  JudgeFn,
} from '../runner/types.js'

function parseArgs(argv: readonly string[]): {
  includeHeldOut: boolean
  categories: BenchmarkCategory[]
  taskIds: string[]
  stub: boolean
} {
  const includeHeldOut = argv.includes('--held-out')
  const stub = argv.includes('--stub')
  const categories: BenchmarkCategory[] = []
  const taskIds: string[] = []
  for (const a of argv) {
    if (a.startsWith('--category=')) {
      categories.push(a.slice('--category='.length) as BenchmarkCategory)
    } else if (a.startsWith('--task=')) {
      taskIds.push(a.slice('--task='.length))
    }
  }
  return { includeHeldOut, categories, taskIds, stub }
}

function stubAgentFactory(): Agent {
  return {
    async run(_: AgentInvocation): Promise<AgentOutput> {
      return { text: '', durationMs: 0, tokensUsed: 0, costUsd: 0 }
    },
  }
}

const stubJudge: JudgeFn = async ({ task }) => ({
  score: 0,
  reasoning: 'stub judge (CI smoke)',
  perCriterion: task.expectedOutcome.rubric.map((c) => ({ criterion: c, met: false })),
})

/**
 * Deterministic lightweight judge for local factory runs — scores keyword
 * presence so CI can gate without a live model.
 */
const localJudge: JudgeFn = async ({ task, output }) => {
  const text = (output.text ?? '').toLowerCase()
  const keywords = task.expectedOutcome.mustMentionKeywords ?? []
  const forbidden = task.expectedOutcome.mustNotMention ?? []
  const perCriterion = task.expectedOutcome.rubric.map((c) => {
    const needle = c.toLowerCase().slice(0, 24)
    return { criterion: c, met: !needle || text.includes(needle) || text.length > 80 }
  })
  let score = 50
  if (keywords.length) {
    const hit = keywords.filter((k) => text.includes(k.toLowerCase())).length
    score = Math.round((hit / keywords.length) * 100)
  } else if (text.length > 40) {
    score = 75
  }
  for (const f of forbidden) {
    if (text.includes(f.toLowerCase())) score = Math.min(score, 20)
  }
  for (const pc of perCriterion) {
    if (pc.met) score = Math.min(100, score + 5)
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    reasoning: 'local heuristic judge (no live model)',
    perCriterion,
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const runner = createBenchmarkRunner()
  const result = await runner.run({
    agentFactory: args.stub ? stubAgentFactory : createEyasAgentFactory(),
    includeHeldOut: args.includeHeldOut,
    categories: args.categories.length ? args.categories : undefined,
    taskIds: args.taskIds.length ? args.taskIds : undefined,
    judge: args.stub ? stubJudge : localJudge,
  })
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result.summary, null, 2))
  if (result.markdownReportPath) {
    // eslint-disable-next-line no-console
    console.log('report:', result.markdownReportPath)
  }
  process.exit(result.summary.errored > 0 ? 1 : 0)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(2)
})
