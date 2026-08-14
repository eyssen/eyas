import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTasksFromDir } from './task-loader.js'
import { pickPrompt, createRng } from './prompt-variations.js'
import {
  buildJudgePrompt,
  composeResult,
  parseJudgeResponse,
  runDeterministicChecks,
} from './scorer.js'
import type {
  AgentFactory,
  BenchmarkTask,
  JudgeFn,
  RubricScore,
  RunOptions,
  RunResult,
  RunSummary,
  TaskResult,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const HARNESS_ROOT = resolve(__dirname, '..')

const DEFAULT_TASKS_DIR = join(HARNESS_ROOT, 'tasks')
const DEFAULT_HELD_OUT_DIR = join(HARNESS_ROOT, 'held-out')
const DEFAULT_REPORTS_DIR = join(HARNESS_ROOT, 'reports')

/**
 * Default judge — calls a model through EYAS's model gateway. Kept lazy so the
 * harness can be imported (and tested) without the gateway being wired up.
 */
function createDefaultJudge(): JudgeFn {
  return async ({ task, agentOutput, promptUsed }) => {
    const { buildJudgePrompt: build } = await import('./scorer.js')
    const { system, user } = build(task, agentOutput, promptUsed)
    let gateway: {
      complete: (req: {
        system: string
        messages: Array<{ role: 'user' | 'assistant'; content: string }>
        maxTokens: number
        temperature: number
      }) => Promise<{ text?: string; content?: Array<{ type: string; text?: string }> }>
    }
    try {
      const mod = await import('../../../src/modules/model/gateway.js')
      const g = mod.createModelGateway() as unknown
      gateway = g as typeof gateway
    } catch (err) {
      return {
        score: 0,
        reasoning: `Model gateway unavailable: ${(err as Error).message}`,
        perCriterion: task.expectedOutcome.rubric.map((c) => ({
          criterion: c,
          met: false,
        })),
      }
    }
    try {
      const resp = await gateway.complete({
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 1024,
        temperature: 0,
      })
      const text =
        resp.text ??
        (Array.isArray(resp.content)
          ? resp.content
              .filter((b) => b.type === 'text')
              .map((b) => b.text ?? '')
              .join('')
          : '')
      return parseJudgeResponse(text, task.expectedOutcome.rubric)
    } catch (err) {
      return {
        score: 0,
        reasoning: `Judge call failed: ${(err as Error).message}`,
        perCriterion: task.expectedOutcome.rubric.map((c) => ({
          criterion: c,
          met: false,
        })),
      }
    }
  }
}

/**
 * Run tasks with bounded parallelism. Preserves input order in the result.
 */
async function runPool<T, R>(
  items: T[],
  parallelism: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const conc = Math.max(1, parallelism)
  let next = 0
  async function drain(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, drain))
  return results
}

async function runOneTask(args: {
  task: BenchmarkTask
  agentFactory: AgentFactory
  judge: JudgeFn
  seed: number
  index: number
}): Promise<TaskResult> {
  const { task, agentFactory, judge, seed, index } = args
  // Per-task RNG so parallelism doesn't perturb reproducibility.
  const rng = createRng(seed + index)
  const promptUsed = pickPrompt(task, rng)
  const agent = agentFactory()
  const start = Date.now()
  try {
    const output = await agent.run({
      prompt: promptUsed,
      context: task.context,
      task,
    })
    const deterministicChecks = runDeterministicChecks(task, output)
    const hardFail = deterministicChecks.some((c) => !c.passed)
    let rubric: RubricScore | undefined
    if (!hardFail) {
      rubric = await judge({ task, agentOutput: output, promptUsed })
    } else {
      rubric = {
        score: 0,
        reasoning: 'Skipped rubric — deterministic gate failed.',
        perCriterion: task.expectedOutcome.rubric.map((c) => ({
          criterion: c,
          met: false,
        })),
      }
    }
    return composeResult({
      task,
      promptUsed,
      output,
      deterministicChecks,
      rubric,
    })
  } catch (err) {
    return {
      taskId: task.id,
      category: task.category,
      status: 'errored',
      promptUsed,
      deterministicChecks: [],
      compositeScore: 0,
      error: `${(err as Error).name}: ${(err as Error).message}`,
      timestamp: new Date().toISOString(),
      output: {
        text: '',
        durationMs: Date.now() - start,
      },
    }
  }
}

function summarize(results: TaskResult[], previousAvgScore?: number): RunSummary {
  const passed = results.filter((r) => r.status === 'passed').length
  const failed = results.filter((r) => r.status === 'failed').length
  const errored = results.filter((r) => r.status === 'errored').length
  const scored = results.filter((r) => r.status !== 'errored')
  const avgScore =
    scored.length === 0
      ? 0
      : scored.reduce((sum, r) => sum + r.compositeScore, 0) / scored.length
  const totalCostUsd = results.reduce(
    (s, r) => s + (r.output?.costUsd ?? 0),
    0,
  )
  const totalDurationMs = results.reduce(
    (s, r) => s + (r.output?.durationMs ?? 0),
    0,
  )
  const delta =
    typeof previousAvgScore === 'number' ? avgScore - previousAvgScore : undefined
  return {
    passed,
    failed,
    errored,
    avgScore: Number(avgScore.toFixed(2)),
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    totalDurationMs,
    tasksAttempted: results.length,
    regressionDeltaPoints: delta === undefined ? undefined : Number(delta.toFixed(2)),
  }
}

function renderMarkdownReport(
  results: TaskResult[],
  summary: RunSummary,
  startedAt: string,
): string {
  const lines: string[] = []
  lines.push(`# Benchmark run ${startedAt}`)
  lines.push('')
  lines.push(`- Tasks: ${summary.passed + summary.failed + summary.errored} / ${summary.tasksAttempted} attempted`)
  lines.push(`- Passed (score >= 70): ${summary.passed}`)
  lines.push(`- Failed: ${summary.failed}`)
  lines.push(`- Errored: ${summary.errored}`)
  lines.push(`- Avg score: ${summary.avgScore.toFixed(1)}`)
  lines.push(`- Total cost: $${summary.totalCostUsd.toFixed(2)}`)
  lines.push(`- Total duration: ${(summary.totalDurationMs / 1000).toFixed(1)}s`)
  if (summary.regressionDeltaPoints !== undefined) {
    const sign = summary.regressionDeltaPoints >= 0 ? '+' : ''
    lines.push(`- Regression vs previous run: ${sign}${summary.regressionDeltaPoints.toFixed(1)} points`)
  }
  lines.push('')
  lines.push('## Per-task results')
  lines.push('')
  lines.push('| Task | Category | Status | Score | Notes |')
  lines.push('|------|----------|--------|-------|-------|')
  for (const r of results) {
    const note = r.error
      ? r.error.slice(0, 60)
      : r.rubric?.reasoning.slice(0, 60) ?? ''
    lines.push(
      `| ${r.taskId} | ${r.category} | ${r.status} | ${r.compositeScore} | ${note.replace(/\|/g, '\\|')} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

export interface BenchmarkRunner {
  run(opts: RunOptions): Promise<RunResult>
}

export function createBenchmarkRunner(): BenchmarkRunner {
  return {
    async run(opts: RunOptions): Promise<RunResult> {
      const tasksDir = opts.tasksDir ?? DEFAULT_TASKS_DIR
      const heldOutDir = opts.heldOutDir ?? DEFAULT_HELD_OUT_DIR
      const reportsDir = opts.reportsDir ?? DEFAULT_REPORTS_DIR
      const parallelism = opts.parallelism ?? 4
      const seed = opts.seed ?? Date.now()
      const judge = opts.judge ?? createDefaultJudge()

      const mainTasks = await loadTasksFromDir(tasksDir, {
        categories: opts.categories,
        taskIds: opts.taskIds,
      })
      let tasks = [...mainTasks]
      if (opts.includeHeldOut) {
        const held = await loadTasksFromDir(heldOutDir, {
          categories: opts.categories,
          taskIds: opts.taskIds,
        })
        tasks = tasks.concat(held)
      }

      const startedAt = new Date().toISOString()
      const results = await runPool(tasks, parallelism, (task, index) =>
        runOneTask({
          task,
          agentFactory: opts.agentFactory,
          judge,
          seed,
          index,
        }),
      )
      const finishedAt = new Date().toISOString()

      const summary = summarize(results, opts.previousAvgScore)
      const runResult: RunResult = {
        tasks: results,
        summary,
        startedAt,
        finishedAt,
      }

      if (!opts.skipReportWrite) {
        await mkdir(reportsDir, { recursive: true })
        const stamp = startedAt.replace(/[:.]/g, '-')
        const jsonPath = join(reportsDir, `report-${stamp}.json`)
        const mdPath = join(reportsDir, `report-${stamp}.md`)
        await writeFile(jsonPath, JSON.stringify(runResult, null, 2), 'utf-8')
        await writeFile(
          mdPath,
          renderMarkdownReport(results, summary, startedAt),
          'utf-8',
        )
        runResult.reportPath = jsonPath
        runResult.markdownReportPath = mdPath
      }
      return runResult
    },
  }
}

export const benchmarkRunner = createBenchmarkRunner()
export { renderMarkdownReport, summarize }
