import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBenchmarkRunner, summarize, renderMarkdownReport } from './benchmark-runner.js'
import { loadTasksFromDir, validateTaskObject, TaskLoadError } from './task-loader.js'
import {
  runDeterministicChecks,
  buildJudgePrompt,
  parseJudgeResponse,
  composeResult,
} from './scorer.js'
import { createRng, pickPrompt } from './prompt-variations.js'
import type { Agent, BenchmarkTask, JudgeFn } from './types.js'

const GOOD_TASK: BenchmarkTask = {
  id: 't-good-1',
  category: 'email-triage',
  prompt: 'Original prompt.',
  promptVariations: ['Variation A', 'Variation B'],
  expectedOutcome: {
    mustMentionKeywords: ['delivery'],
    mustNotMention: ['password'],
    rubric: ['Identifies intent', 'Proposes next step'],
  },
  maxTokens: 1000,
  maxCostUsd: 0.01,
  maxDurationSec: 10,
}

describe('task-loader', () => {
  it('parses a valid JSON task file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bench-loader-'))
    await mkdir(join(dir, 'email-triage'))
    await writeFile(
      join(dir, 'email-triage', 'sample.json'),
      JSON.stringify(GOOD_TASK),
      'utf-8',
    )
    const tasks = await loadTasksFromDir(dir)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.id).toBe('t-good-1')
  })

  it('rejects malformed JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bench-loader-bad-'))
    await writeFile(join(dir, 'broken.json'), '{ not json', 'utf-8')
    await expect(loadTasksFromDir(dir)).rejects.toBeInstanceOf(TaskLoadError)
  })

  it('rejects tasks missing required fields', () => {
    expect(() =>
      validateTaskObject({ id: 'x', category: 'email-triage' }),
    ).toThrow(TaskLoadError)
  })

  it('rejects unknown categories', () => {
    expect(() =>
      validateTaskObject({
        id: 'x',
        category: 'bogus',
        prompt: 'p',
        expectedOutcome: { rubric: ['r'] },
      }),
    ).toThrow(/Unknown category/)
  })

  it('filters by category and taskId', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bench-loader-filter-'))
    await mkdir(join(dir, 'email-triage'))
    await mkdir(join(dir, 'coding'))
    await writeFile(
      join(dir, 'email-triage', 'a.json'),
      JSON.stringify(GOOD_TASK),
      'utf-8',
    )
    await writeFile(
      join(dir, 'coding', 'b.json'),
      JSON.stringify({ ...GOOD_TASK, id: 't-good-2', category: 'coding' }),
      'utf-8',
    )
    const onlyCoding = await loadTasksFromDir(dir, { categories: ['coding'] })
    expect(onlyCoding).toHaveLength(1)
    expect(onlyCoding[0]!.category).toBe('coding')
    const byId = await loadTasksFromDir(dir, { taskIds: ['t-good-1'] })
    expect(byId).toHaveLength(1)
  })
})

describe('scorer: deterministic checks', () => {
  it('passes when keywords present and absent-list respected', () => {
    const checks = runDeterministicChecks(GOOD_TASK, {
      text: 'Please confirm the delivery date with the client.',
      tokensUsed: 50,
      costUsd: 0.001,
      durationMs: 500,
    })
    expect(checks.every((c) => c.passed)).toBe(true)
  })

  it('fails when required keyword missing', () => {
    const checks = runDeterministicChecks(GOOD_TASK, {
      text: 'No relevant content here.',
      tokensUsed: 50,
      costUsd: 0.001,
      durationMs: 500,
    })
    expect(checks.find((c) => c.name === 'must-mention:delivery')?.passed).toBe(false)
  })

  it('fails when forbidden keyword appears', () => {
    const checks = runDeterministicChecks(GOOD_TASK, {
      text: 'The delivery password is 12345.',
      tokensUsed: 50,
      costUsd: 0.001,
      durationMs: 500,
    })
    expect(checks.find((c) => c.name === 'must-not-mention:password')?.passed).toBe(false)
  })

  it('enforces cost and duration caps', () => {
    const checks = runDeterministicChecks(GOOD_TASK, {
      text: 'delivery scheduled.',
      tokensUsed: 9999,
      costUsd: 1.5,
      durationMs: 60_000,
    })
    expect(checks.find((c) => c.name === 'cap:maxTokens')?.passed).toBe(false)
    expect(checks.find((c) => c.name === 'cap:maxCostUsd')?.passed).toBe(false)
    expect(checks.find((c) => c.name === 'cap:maxDurationSec')?.passed).toBe(false)
  })
})

describe('scorer: judge prompt', () => {
  it('builds a well-formed judge prompt including every rubric line', () => {
    const { system, user } = buildJudgePrompt(
      GOOD_TASK,
      { text: 'Agent output.', durationMs: 100 },
      'Prompt used',
    )
    expect(system).toMatch(/strict benchmark judge/i)
    expect(system).toMatch(/valid JSON/i)
    expect(user).toContain('Identifies intent')
    expect(user).toContain('Proposes next step')
    expect(user).toContain('Agent output.')
    expect(user).toContain('Prompt used')
  })

  it('parses a well-formed judge response', () => {
    const raw = JSON.stringify({
      score: 83,
      reasoning: 'Solid pass',
      perCriterion: [{ criterion: 'Identifies intent', met: true }],
    })
    const parsed = parseJudgeResponse(raw, ['Identifies intent'])
    expect(parsed.score).toBe(83)
    expect(parsed.perCriterion[0]!.met).toBe(true)
  })

  it('tolerates markdown fences around JSON', () => {
    const raw = '```json\n{"score": 70, "reasoning": "ok", "perCriterion": []}\n```'
    const parsed = parseJudgeResponse(raw, ['x'])
    expect(parsed.score).toBe(70)
  })

  it('returns 0 for unparseable responses', () => {
    const parsed = parseJudgeResponse('not json at all', ['criterion'])
    expect(parsed.score).toBe(0)
  })

  it('clamps out-of-range scores', () => {
    const parsed = parseJudgeResponse(
      JSON.stringify({ score: 250, reasoning: '', perCriterion: [] }),
      ['c'],
    )
    expect(parsed.score).toBe(100)
  })
})

describe('scorer: compose result', () => {
  it('hard-fails composite to 0 when a deterministic check fails', () => {
    const res = composeResult({
      task: GOOD_TASK,
      promptUsed: 'p',
      output: { text: 'no keyword', durationMs: 100 },
      deterministicChecks: [
        { name: 'must-mention:delivery', passed: false },
      ],
      rubric: { score: 95, reasoning: '', perCriterion: [] },
    })
    expect(res.compositeScore).toBe(0)
    expect(res.status).toBe('failed')
  })

  it('passes when all gates green and rubric >= 70', () => {
    const res = composeResult({
      task: GOOD_TASK,
      promptUsed: 'p',
      output: { text: 'delivery ok', durationMs: 100 },
      deterministicChecks: [{ name: 'must-mention:delivery', passed: true }],
      rubric: { score: 85, reasoning: '', perCriterion: [] },
    })
    expect(res.compositeScore).toBe(85)
    expect(res.status).toBe('passed')
  })
})

describe('prompt-variations', () => {
  it('produces reproducible picks with a fixed seed', () => {
    const rng1 = createRng(42)
    const rng2 = createRng(42)
    const a = pickPrompt(GOOD_TASK, rng1)
    const b = pickPrompt(GOOD_TASK, rng2)
    expect(a).toBe(b)
  })

  it('eventually picks different variations across seeds', () => {
    const seen = new Set<string>()
    for (let s = 0; s < 20; s++) {
      seen.add(pickPrompt(GOOD_TASK, createRng(s)))
    }
    // Original + 2 variations = 3 candidates. With 20 seeds we should see >= 2.
    expect(seen.size).toBeGreaterThanOrEqual(2)
  })
})

describe('runner: integration with mocked agent + judge', () => {
  function makeAgent(text: string): Agent {
    return {
      async run() {
        return {
          text,
          tokensUsed: 100,
          costUsd: 0.001,
          durationMs: 50,
        }
      },
    }
  }

  async function setupTasksDir(tasks: BenchmarkTask[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bench-run-'))
    for (const t of tasks) {
      const sub = join(dir, t.category)
      await mkdir(sub, { recursive: true })
      await writeFile(join(sub, `${t.id}.json`), JSON.stringify(t), 'utf-8')
    }
    return dir
  }

  it('aggregates passed/failed/errored results correctly', async () => {
    const pass: BenchmarkTask = { ...GOOD_TASK, id: 'p1' }
    const fail: BenchmarkTask = { ...GOOD_TASK, id: 'f1' }
    const tasksDir = await setupTasksDir([pass, fail])
    const reportsDir = await mkdtemp(join(tmpdir(), 'bench-reports-'))

    // Alternate agents per task via a shared counter.
    let call = 0
    const agentFactory = () => {
      call++
      return call === 1
        ? makeAgent('The delivery is on track.')
        : makeAgent('Nothing useful here.')
    }

    const judge: JudgeFn = async () => ({
      score: 90,
      reasoning: 'ok',
      perCriterion: [],
    })

    const runner = createBenchmarkRunner()
    const result = await runner.run({
      agentFactory,
      tasksDir,
      reportsDir,
      parallelism: 1,
      seed: 7,
      judge,
    })
    expect(result.tasks).toHaveLength(2)
    expect(result.summary.passed + result.summary.failed).toBe(2)
    expect(result.summary.errored).toBe(0)
    expect(result.reportPath).toBeTruthy()
    expect(result.markdownReportPath).toBeTruthy()
    const md = await readFile(result.markdownReportPath!, 'utf-8')
    expect(md).toMatch(/Benchmark run/)
  })

  it('respects parallelism without dropping results', async () => {
    const tasks: BenchmarkTask[] = Array.from({ length: 8 }, (_, i) => ({
      ...GOOD_TASK,
      id: `par-${i}`,
    }))
    const tasksDir = await setupTasksDir(tasks)
    const reportsDir = await mkdtemp(join(tmpdir(), 'bench-reports-par-'))
    const judge: JudgeFn = async () => ({ score: 80, reasoning: 'ok', perCriterion: [] })
    const runner = createBenchmarkRunner()
    const result = await runner.run({
      agentFactory: () => makeAgent('delivery confirmed'),
      tasksDir,
      reportsDir,
      parallelism: 4,
      seed: 1,
      judge,
      skipReportWrite: true,
    })
    expect(result.tasks).toHaveLength(8)
    expect(result.tasks.map((t) => t.taskId).sort()).toEqual(
      tasks.map((t) => t.id).sort(),
    )
  })

  it('records errors when the agent throws', async () => {
    const tasksDir = await setupTasksDir([GOOD_TASK])
    const runner = createBenchmarkRunner()
    const judge: JudgeFn = async () => ({ score: 0, reasoning: '', perCriterion: [] })
    const result = await runner.run({
      agentFactory: () => ({
        async run() {
          throw new Error('model timeout')
        },
      }),
      tasksDir,
      parallelism: 1,
      seed: 1,
      judge,
      skipReportWrite: true,
    })
    expect(result.summary.errored).toBe(1)
    expect(result.tasks[0]!.status).toBe('errored')
    expect(result.tasks[0]!.error).toMatch(/model timeout/)
  })

  it('optionally includes held-out tasks', async () => {
    const tasksDir = await setupTasksDir([GOOD_TASK])
    const heldOutDir = await setupTasksDir([{ ...GOOD_TASK, id: 'held-1' }])
    const runner = createBenchmarkRunner()
    const judge: JudgeFn = async () => ({ score: 85, reasoning: 'ok', perCriterion: [] })
    const withoutHeld = await runner.run({
      agentFactory: () => makeAgent('delivery ok'),
      tasksDir,
      heldOutDir,
      parallelism: 1,
      seed: 1,
      judge,
      skipReportWrite: true,
    })
    const withHeld = await runner.run({
      agentFactory: () => makeAgent('delivery ok'),
      tasksDir,
      heldOutDir,
      includeHeldOut: true,
      parallelism: 1,
      seed: 1,
      judge,
      skipReportWrite: true,
    })
    expect(withoutHeld.tasks).toHaveLength(1)
    expect(withHeld.tasks).toHaveLength(2)
  })

  it('reports regression delta vs previous run', async () => {
    const tasksDir = await setupTasksDir([GOOD_TASK])
    const runner = createBenchmarkRunner()
    const judge: JudgeFn = async () => ({ score: 80, reasoning: 'ok', perCriterion: [] })
    const result = await runner.run({
      agentFactory: () => makeAgent('delivery ok'),
      tasksDir,
      previousAvgScore: 75,
      parallelism: 1,
      judge,
      skipReportWrite: true,
    })
    expect(result.summary.regressionDeltaPoints).toBe(5)
  })
})

describe('summary + markdown renderer', () => {
  it('computes averages and totals', () => {
    const s = summarize(
      [
        {
          taskId: 'a',
          category: 'coding',
          status: 'passed',
          promptUsed: 'p',
          deterministicChecks: [],
          compositeScore: 90,
          timestamp: 'x',
          output: { text: '', durationMs: 100, costUsd: 0.01 },
        },
        {
          taskId: 'b',
          category: 'coding',
          status: 'failed',
          promptUsed: 'p',
          deterministicChecks: [],
          compositeScore: 0,
          timestamp: 'x',
          output: { text: '', durationMs: 200, costUsd: 0.02 },
        },
      ],
      70,
    )
    expect(s.passed).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.avgScore).toBe(45)
    expect(s.totalCostUsd).toBeCloseTo(0.03)
    expect(s.totalDurationMs).toBe(300)
    expect(s.regressionDeltaPoints).toBe(-25)
  })

  it('renders a markdown report with a per-task table', () => {
    const md = renderMarkdownReport(
      [
        {
          taskId: 'x',
          category: 'meetings',
          status: 'passed',
          promptUsed: 'p',
          deterministicChecks: [],
          compositeScore: 88,
          timestamp: 'x',
          output: { text: 'ok', durationMs: 100 },
          rubric: { score: 88, reasoning: 'great', perCriterion: [] },
        },
      ],
      summarize([
        {
          taskId: 'x',
          category: 'meetings',
          status: 'passed',
          promptUsed: 'p',
          deterministicChecks: [],
          compositeScore: 88,
          timestamp: 'x',
          output: { text: '', durationMs: 100, costUsd: 0 },
        },
      ]),
      '2026-04-16T17:45:00Z',
    )
    expect(md).toMatch(/# Benchmark run 2026-04-16T17:45:00Z/)
    expect(md).toMatch(/\| x \| meetings \| passed \| 88 \|/)
  })
})

describe('real task files', () => {
  it('loads every bundled task file without error', async () => {
    const root = new URL('../tasks', import.meta.url).pathname
    const tasks = await loadTasksFromDir(root)
    expect(tasks.length).toBeGreaterThanOrEqual(15)
    // Categories represented
    const cats = new Set(tasks.map((t) => t.category))
    expect(cats.has('email-triage')).toBe(true)
    expect(cats.has('coding')).toBe(true)
    expect(cats.has('ops')).toBe(true)
    expect(cats.has('research')).toBe(true)
    expect(cats.has('meetings')).toBe(true)
  })

  it('loads every held-out task without error', async () => {
    const root = new URL('../held-out', import.meta.url).pathname
    const tasks = await loadTasksFromDir(root)
    expect(tasks.length).toBeGreaterThanOrEqual(3)
  })

  it('has no duplicate task ids across tasks+held-out', async () => {
    const tasksRoot = new URL('../tasks', import.meta.url).pathname
    const heldRoot = new URL('../held-out', import.meta.url).pathname
    const all = (await loadTasksFromDir(tasksRoot)).concat(
      await loadTasksFromDir(heldRoot),
    )
    const ids = all.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every task declares at least one rubric line', async () => {
    const tasksRoot = new URL('../tasks', import.meta.url).pathname
    const tasks = await loadTasksFromDir(tasksRoot)
    for (const t of tasks) {
      expect(t.expectedOutcome.rubric.length).toBeGreaterThan(0)
    }
  })
})

describe('artifacts', () => {
  it('report filenames include the timestamp', async () => {
    const tasksDir = await mkdtemp(join(tmpdir(), 'bench-report-names-'))
    await mkdir(join(tasksDir, 'coding'), { recursive: true })
    await writeFile(
      join(tasksDir, 'coding', 'only.json'),
      JSON.stringify({ ...GOOD_TASK, id: 'rep-1', category: 'coding' }),
      'utf-8',
    )
    const reportsDir = await mkdtemp(join(tmpdir(), 'bench-report-out-'))
    const runner = createBenchmarkRunner()
    const judge: JudgeFn = async () => ({ score: 90, reasoning: 'ok', perCriterion: [] })
    await runner.run({
      agentFactory: () => ({
        async run() {
          return { text: 'delivery ok', durationMs: 10 }
        },
      }),
      tasksDir,
      reportsDir,
      parallelism: 1,
      judge,
    })
    const files = await readdir(reportsDir)
    expect(files.some((f) => f.startsWith('report-') && f.endsWith('.json'))).toBe(true)
    expect(files.some((f) => f.startsWith('report-') && f.endsWith('.md'))).toBe(true)
  })
})
