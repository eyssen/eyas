// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMemoryDb } from '../../../helpers/test-db'
import { createArtifactTables } from '../../../../src/modules/artifacts/schema'
import { createArtifactService } from '../../../../src/modules/artifacts/artifact-service'
import { createPipelineTables } from '../../../../src/modules/pipelines/ticket-to-code/schema'
import type {
  AgentRunnerPort,
  ArtifactServicePort,
  CheckpointPort,
  PRClientPort,
  TicketSourcePort,
  PipelineDeps,
  AgentRunInput,
  AgentRunOutput,
  PullRequestInput,
  PullRequestResult,
} from '../../../../src/modules/pipelines/ticket-to-code/port-types'
import type { TicketContext } from '../../../../src/modules/pipelines/ticket-to-code/types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function loadTicketFixture(name: 'ticket-feature-request' | 'ticket-bug-report'): TicketContext {
  const p = join(__dirname, 'fixtures', `${name}.json`)
  return JSON.parse(readFileSync(p, 'utf-8')) as TicketContext
}

// ─── Mock ports ────────────────────────────────────────────

export interface MockTicketSource extends TicketSourcePort {
  calls: Array<{ source: string; id: string }>
}

export function createMockTicketSource(tickets: Record<string, TicketContext>): MockTicketSource {
  const calls: Array<{ source: string; id: string }> = []
  return {
    calls,
    async fetchTicket(source, id) {
      calls.push({ source, id })
      const key = `${source}:${id}`
      const t = tickets[key]
      if (!t) throw new Error(`No fixture for ${key}`)
      return t
    },
  }
}

export interface MockAgentRunner extends AgentRunnerPort {
  calls: AgentRunInput[]
  setResponse: (agentId: string, output: AgentRunOutput) => void
  setResponder: (fn: (input: AgentRunInput) => AgentRunOutput | Promise<AgentRunOutput>) => void
}

export function createMockAgentRunner(defaults: Record<string, AgentRunOutput> = {}): MockAgentRunner {
  const calls: AgentRunInput[] = []
  const responses = new Map<string, AgentRunOutput>(Object.entries(defaults))
  let responder: ((input: AgentRunInput) => AgentRunOutput | Promise<AgentRunOutput>) | null = null

  return {
    calls,
    setResponse(agentId, output) {
      responses.set(agentId, output)
    },
    setResponder(fn) {
      responder = fn
    },
    async run(input) {
      calls.push(input)
      if (responder) return responder(input)
      const hit = responses.get(input.agentId)
      if (hit) return hit
      return { text: '{}', json: {} }
    },
  }
}

export interface MockPRClient extends PRClientPort {
  calls: PullRequestInput[]
  nextResult: PullRequestResult | null
  shouldThrow: Error | null
}

export function createMockPRClient(): MockPRClient {
  const calls: PullRequestInput[] = []
  const client: MockPRClient = {
    calls,
    nextResult: null,
    shouldThrow: null,
    async openPullRequest(input) {
      calls.push(input)
      if (client.shouldThrow) throw client.shouldThrow
      if (client.nextResult) return client.nextResult
      return {
        provider: 'stub',
        url: `https://stub.local/pr/${input.branch}`,
        number: 1,
        branch: input.branch,
        status: 'open',
      }
    },
  }
  return client
}

export function createMockCheckpoint(): CheckpointPort & { saves: Array<{ key: string; value: unknown }> } {
  const saves: Array<{ key: string; value: unknown }> = []
  return {
    saves,
    async save(key, value) {
      saves.push({ key, value })
    },
    async load() {
      return undefined
    },
  }
}

/**
 * Build a fresh in-memory DB + a fully wired DepBag for pipeline tests.
 * Uses the REAL ArtifactService against a REAL in-memory artifacts schema
 * so we exercise payload validation end-to-end.
 */
export function buildTestHarness(overrides: {
  tickets?: Record<string, TicketContext>
  agentResponses?: Record<string, AgentRunOutput>
} = {}) {
  const db = createMemoryDb()
  createArtifactTables(db)
  createPipelineTables(db)

  const rawArtifactService = createArtifactService(db)
  const artifactPort: ArtifactServicePort = {
    create: (input) => rawArtifactService.create(input as any) as any,
    getWithPayload: (id) => rawArtifactService.getWithPayload(id) as any,
    link: (from, to, t) => rawArtifactService.link(from, to, t),
  }

  const ticketSource = createMockTicketSource(overrides.tickets ?? {})
  const agentRunner = createMockAgentRunner(overrides.agentResponses ?? {})
  const prClient = createMockPRClient()
  const checkpoint = createMockCheckpoint()

  let counter = 0
  const deps: PipelineDeps = {
    ticketSource,
    agentRunner,
    artifacts: artifactPort,
    prClient,
    checkpoint,
    newId: () => `id_${++counter}_${Math.random().toString(36).slice(2, 8)}`,
    now: () => 1_700_000_000_000 + counter * 1000,
  }

  return { db, deps, artifactPort, rawArtifactService, ticketSource, agentRunner, prClient, checkpoint }
}
