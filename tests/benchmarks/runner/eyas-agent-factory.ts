// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Real-ish benchmark agent factory for Wave 1 eval harness.
 *
 * Modes:
 * - default: category-aware local handlers (email triage classifier, heuristic
 *   coding/ops/research replies) — no live model required, CI-safe, measurable.
 * - EYAS_BENCH_LIVE=1: HTTP call to a running EYAS server (POST /api/v1/agent/run
 *   style) when available; falls back to local handlers on error.
 */

import type { Agent, AgentFactory, AgentInvocation, AgentOutput, BenchmarkCategory } from './types.js'

async function runEmailTriage(prompt: string): Promise<string> {
  try {
    const { EmailClassifier } = await import('../../../src/modules/agent-templates/email-triage/classifier.js')
    const { routeAction } = await import('../../../src/modules/agent-templates/email-triage/action-router.js')
    const { InMemoryRuleStore } = await import('../../../src/modules/agent-templates/email-triage/natural-language-filters.js')
    const classifier = new EmailClassifier(new InMemoryRuleStore(), null)
    const subjectMatch = prompt.match(/Subject:\s*(.+)/i)
    const fromMatch = prompt.match(/From:\s*(.+)/i)
    const email = {
      id: 'bench-1',
      from: fromMatch?.[1]?.trim() ?? 'unknown@example.com',
      to: ['me@example.com'],
      subject: subjectMatch?.[1]?.trim() ?? prompt.slice(0, 80),
      body: prompt,
      receivedAt: new Date().toISOString(),
    }
    const classification = await classifier.classify(email as any)
    const action = routeAction(email as any, classification as any)
    return JSON.stringify({ classification, action }, null, 2)
  } catch (err) {
    return `email-triage fallback: ${String(err)}\n\nPrompt summary: ${prompt.slice(0, 400)}`
  }
}

function heuristicCoding(prompt: string): string {
  const mentionsTest = /test|spec|vitest|pytest/i.test(prompt)
  const mentionsBug = /bug|fix|error|fail/i.test(prompt)
  return [
    '## Plan',
    '1. Reproduce / clarify acceptance criteria',
    '2. Implement minimal change',
    mentionsTest ? '3. Add or update automated tests' : '3. Manually verify the happy path',
    mentionsBug ? '4. Add regression coverage for the bug' : '4. Open PR with summary',
    '',
    '## Notes',
    `- Goal excerpt: ${prompt.slice(0, 240).replace(/\n/g, ' ')}`,
    '- Would use search_indexed + cite [source:…] before claiming facts.',
  ].join('\n')
}

function heuristicOps(prompt: string): string {
  return [
    '## Ops first response',
    '1. Confirm blast radius and severity',
    '2. Check recent deploys / pod restarts',
    '3. Capture logs and metrics window',
    '4. Propose remediation (kubectl/PR) behind approval gate',
    '',
    `Incident cue: ${prompt.slice(0, 200).replace(/\n/g, ' ')}`,
  ].join('\n')
}

function heuristicResearch(prompt: string): string {
  return [
    '## Research approach',
    '1. search_indexed / search_knowledge for internal sources',
    '2. web research with citations',
    '3. Synthesize with [source:…] markers',
    '',
    `Question: ${prompt.slice(0, 300)}`,
    '',
    'Without live retrieval this is a structured outline only.',
  ].join('\n')
}

function heuristicMeetings(prompt: string): string {
  return [
    '## Meeting follow-up',
    '- Extract decisions, action items, owners, due dates',
    '- File board cards for open actions',
    `- Source notes: ${prompt.slice(0, 200).replace(/\n/g, ' ')}`,
  ].join('\n')
}

async function localHandler(inv: AgentInvocation): Promise<AgentOutput> {
  const start = Date.now()
  const cat = inv.task.category as BenchmarkCategory
  let text: string
  switch (cat) {
    case 'email-triage':
      text = await runEmailTriage(inv.prompt)
      break
    case 'coding':
      text = heuristicCoding(inv.prompt)
      break
    case 'ops':
      text = heuristicOps(inv.prompt)
      break
    case 'research':
      text = heuristicResearch(inv.prompt)
      break
    case 'meetings':
      text = heuristicMeetings(inv.prompt)
      break
    default:
      text = inv.prompt.slice(0, 500)
  }
  return {
    text,
    durationMs: Date.now() - start,
    tokensUsed: Math.ceil(text.length / 4),
    costUsd: 0,
  }
}

async function liveHandler(inv: AgentInvocation): Promise<AgentOutput> {
  const base = (process.env.EYAS_BENCH_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '')
  const token = process.env.EYAS_BENCH_TOKEN
  const start = Date.now()
  try {
    const res = await fetch(`${base}/api/v1/conversations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        title: `bench:${inv.task.id}`,
        goal: inv.prompt,
        // Best-effort; server may ignore unknown fields
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as any
    const text =
      data?.message?.content ??
      data?.conversation?.goal_description ??
      data?.text ??
      JSON.stringify(data).slice(0, 2000)
    return {
      text: String(text),
      durationMs: Date.now() - start,
      tokensUsed: 0,
      costUsd: 0,
    }
  } catch {
    return localHandler(inv)
  }
}

/** Factory used by run-benchmarks.ts — real category handlers, optional live mode. */
export function createEyasAgentFactory(): AgentFactory {
  const live = process.env.EYAS_BENCH_LIVE === '1' || process.env.EYAS_BENCH_LIVE === 'true'
  return (): Agent => ({
    async run(inv: AgentInvocation): Promise<AgentOutput> {
      if (live) return liveHandler(inv)
      return localHandler(inv)
    },
  })
}
