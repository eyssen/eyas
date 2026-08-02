/**
 * CI entry point for the internal benchmark harness.
 *
 * Flags:
 *   --held-out             include the held-out set
 *   --category=<name>      restrict to one category (repeatable)
 *   --task=<id>            restrict to specific task IDs (repeatable)
 *
 * The default agent factory here is a STUB that returns empty text — good
 * enough to exercise the loader/scorer plumbing in CI smoke tests. Replace
 * with a real factory when wiring this into your release pipeline.
 */

import { createBenchmarkRunner } from '../runner/benchmark-runner.js'
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
} {
  const includeHeldOut = argv.includes('--held-out')
  const categories: BenchmarkCategory[] = []
  const taskIds: string[] = []
  for (const a of argv) {
    if (a.startsWith('--category=')) {
      categories.push(a.slice('--category='.length) as BenchmarkCategory)
    } else if (a.startsWith('--task=')) {
      taskIds.push(a.slice('--task='.length))
    }
  }
  return { includeHeldOut, categories, taskIds }
}

/** Replace with the real EYAS agent factory in CI. */
function stubAgentFactory(): Agent {
  return {
    async run(_: AgentInvocation): Promise<AgentOutput> {
      return { text: '', durationMs: 0, tokensUsed: 0, costUsd: 0 }
    },
  }
}

/** Stub judge so CI doesn't call a live model gateway. */
const stubJudge: JudgeFn = async ({ task }) => ({
  score: 0,
  reasoning: 'stub judge (CI smoke)',
  perCriterion: task.expectedOutcome.rubric.map((c) => ({ criterion: c, met: false })),
})

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const runner = createBenchmarkRunner()
  const result = await runner.run({
    agentFactory: stubAgentFactory,
    includeHeldOut: args.includeHeldOut,
    categories: args.categories.length ? args.categories : undefined,
    taskIds: args.taskIds.length ? args.taskIds : undefined,
    judge: stubJudge,
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
