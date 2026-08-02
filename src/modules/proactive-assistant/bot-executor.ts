// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { runConversation } from '@modules/agent/conversation-runner.js'

export function createBotExecutor(deps: {
  db: any
  agentRunner: any
  agentRegistry: any
  toolRegistry: any
  logger: any
  supervisor?: any
  promptAssembler?: any
  // F2 T7 — completeness critic + plan-as-rubric. `eventStore` is read per
  // pass (the caller passes it as a getter) because the event-store module
  // exposes it during its own onStart, after this executor is built.
  critic?: any
  eventStore?: any
  getCheckpoint?: any
  // F2 T8 — threshold-band alert emission on token tracking.
  budgetEngine?: any
  // F2 T9 — config `model.pricing` override for the cost rollup.
  pricingOverrides?: any
}) {
  const { db, agentRunner, agentRegistry, toolRegistry, logger, supervisor, promptAssembler } = deps

  // Single-flight guard. The executor is now kicked by bus events (a card being
  // armed or a task assigned) on top of the 10-minute cron sweep, so several
  // calls can land while a pass is still running. `running` makes concurrent
  // callers piggyback on the in-flight pass; `rerun` makes sure work that
  // arrived DURING that pass is not dropped — the loop runs one more time.
  //
  // Scope caveat: this guard is per-process. Two EYAS processes against the
  // same DB would each run their own pass; the pre-run claim re-check below
  // narrows that window but is not a true CAS (SQLite would need a conditional
  // UPDATE ... WHERE status='waiting' with a rowcount check). Single-process
  // is the deployment model today (see CLAUDE.md: single-process, embedded DB).
  let running: Promise<number> | null = null
  let rerun = false

  /**
   * Reasons a card stays parked in 'waiting' with nothing to do about it: its
   * agent was deleted, disabled, or is over budget, or the card lost its
   * agent/goal. The card is deliberately NOT failed — enabling the agent (or
   * topping up its budget) later must still let it run — but silently
   * re-attempting it on every kick and every cron tick hides a real
   * misconfiguration from the operator.
   */
  const UNRUNNABLE_REASONS = new Set(['agent_unavailable', 'incomplete', 'over_budget'])

  /**
   * Conversation ids already warned about. Per-process and in-memory by design:
   * a restart re-warns once, which is the useful behavior for an operator who
   * just restarted to fix exactly this. Pruned at the end of every pass to the
   * cards still parked, so it stays bounded and a card that leaves and re-enters
   * 'waiting' warns again.
   */
  const warnedUnrunnable = new Set<string>()

  /** One scan-and-run pass over every bot-capable stage. */
  async function pass(): Promise<number> {
    // A stage is bot-capable when a bot watches it OR it names the agent that
    // owns its cards. Scanning bot_listen alone left every auto-assignee stage
    // permanently unprocessed.
    const stages = db.all(sql`
      SELECT id FROM stages WHERE bot_listen = 1 OR auto_assignee_id IS NOT NULL
    `) as any[]

    if (stages.length === 0) return 0

    let processed = 0
    /** Cards still parked this pass — drives the warn-ledger pruning below. */
    const parked = new Set<string>()

    for (const stage of stages) {
      const convs = db.all(sql`
        SELECT id
        FROM conversations
        WHERE stage_id = ${stage.id} AND status = 'waiting' AND mode IN ('managed', 'autonomous')
      `) as any[]

      for (const conv of convs) {
        parked.add(conv.id)

        // Re-check the claim right before running: the scan above is a snapshot,
        // and a run started from another kick (or a user opening the card) may
        // have claimed it in between. Without this, the same card could be run
        // twice concurrently.
        const fresh = (db.all(sql`SELECT status FROM conversations WHERE id = ${conv.id}`) as any[])[0]
        if (!fresh || fresh.status !== 'waiting') {
          parked.delete(conv.id)
          continue
        }

        const result = await runConversation(conv.id, {
          db, agentRunner, agentRegistry, toolRegistry, supervisor, logger, promptAssembler,
          critic: deps.critic, eventStore: deps.eventStore, getCheckpoint: deps.getCheckpoint,
          budgetEngine: deps.budgetEngine, pricingOverrides: deps.pricingOverrides,
        })
        if (result.ran) {
          processed++
        } else if (UNRUNNABLE_REASONS.has(result.reason ?? '') && !warnedUnrunnable.has(conv.id)) {
          warnedUnrunnable.add(conv.id)
          logger.warn(
            { conversationId: conv.id, stageId: stage.id, reason: result.reason },
            'Bot executor: card is parked in a bot stage but cannot run — it stays waiting and will be retried, but needs operator attention',
          )
        }
      }
    }

    // Prune to the still-parked set: bounds the ledger and re-arms the warning
    // for a card that left 'waiting' and later came back.
    for (const id of warnedUnrunnable) {
      if (!parked.has(id)) warnedUnrunnable.delete(id)
    }

    return processed
  }

  return {
    /**
     * Process conversations parked in bot-capable stages.
     * Finds conversations whose stage has bot_listen=1 or an auto-assignee and
     * whose status is 'waiting', then runs each through the shared supervised
     * runConversation unit (the same code path POST /agent/runs/:id/retry uses).
     *
     * Concurrent calls coalesce into a single in-flight pass and all resolve
     * with that pass's processed count.
     */
    async processWaiting(): Promise<number> {
      if (running) {
        rerun = true
        return running
      }

      running = (async () => {
        // Yield once before doing any work: an async IIFE body starts running
        // synchronously, i.e. BEFORE the `running = ...` assignment completes.
        // Without this, a kick emitted synchronously from inside the first pass
        // would still see `running === null` and start a second concurrent one.
        await Promise.resolve()
        let total = 0
        do {
          rerun = false
          total += await pass()
        } while (rerun)
        return total
      })()

      try {
        return await running
      } finally {
        running = null
      }
    },
  }
}
