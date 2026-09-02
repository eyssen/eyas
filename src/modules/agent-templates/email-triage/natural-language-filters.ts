// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { RuleCompiler } from './rule-compiler.js'
import type { CompiledRule, LLMClient, RuleStore } from './types.js'

/**
 * High-level façade for natural-language rule management.
 *
 * Usage:
 *   const nlFilters = new NaturalLanguageFilters(store, llm)
 *   await nlFilters.addFromNl('Forward anything from Kovács to finance@acme.com when the subject mentions invoices.')
 *
 * This is the surface the future settings UI will call — the UI doesn't need
 * to know how the matcher JSON is shaped.
 */
export class NaturalLanguageFilters {
  private readonly compiler: RuleCompiler

  constructor(
    private readonly store: RuleStore,
    llm: LLMClient
  ) {
    this.compiler = new RuleCompiler(llm)
  }

  /** Compile an NL rule and persist it. Returns the compiled rule. */
  async addFromNl(nl: string): Promise<CompiledRule> {
    const rule = await this.compiler.compile(nl)
    await this.store.add(rule)
    return rule
  }

  /** List all persisted rules. */
  async list(): Promise<CompiledRule[]> {
    return this.store.list()
  }

  /** Remove a rule by id. */
  async remove(id: string): Promise<void> {
    await this.store.remove(id)
  }

  /** Remove every rule (dev / test helper). */
  async clear(): Promise<void> {
    await this.store.clear()
  }
}

/**
 * In-memory {@link RuleStore} implementation. This is the default backing
 * store for Phase 4C. When the DB schema lands, swap for a Drizzle-backed
 * store using the `email_triage_rules` table hinted at in manifest.ts.
 */
export class InMemoryRuleStore implements RuleStore {
  private rules: CompiledRule[] = []

  async list(): Promise<CompiledRule[]> {
    return this.rules.slice()
  }

  async add(rule: CompiledRule): Promise<void> {
    this.rules.push(rule)
  }

  async remove(id: string): Promise<void> {
    this.rules = this.rules.filter((r) => r.id !== id)
  }

  async clear(): Promise<void> {
    this.rules = []
  }

  /** Test helper: bulk-seed. */
  async seed(rules: CompiledRule[]): Promise<void> {
    this.rules = rules.slice()
  }
}
