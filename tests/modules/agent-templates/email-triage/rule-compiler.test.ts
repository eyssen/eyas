// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'

import {
  NaturalLanguageFilters,
  RuleCompilationError,
  RuleCompiler,
  parseCompiledRule,
  InMemoryRuleStore,
  type LLMClient,
} from '@modules/agent-templates/email-triage'

class ScriptedLLM implements LLMClient {
  private calls = 0
  constructor(private readonly responses: string[]) {}
  async complete(): Promise<string> {
    const r = this.responses[this.calls] ?? this.responses[this.responses.length - 1]
    this.calls++
    return r
  }
}

describe('parseCompiledRule', () => {
  it('parses a well-formed delegate rule', () => {
    const raw = JSON.stringify({
      label: 'Kovács invoices to finance',
      matcher: {
        from: { contains: 'kovács', caseInsensitive: true },
        subject: { regexIsh: 'invoice|számla', caseInsensitive: true },
      },
      action: { type: 'delegate', to: 'finance@acme.example', template: 'FYI' },
    })

    const rule = parseCompiledRule(raw, 'original NL')
    expect(rule.label).toBe('Kovács invoices to finance')
    expect(rule.matcher.from?.contains).toBe('kovács')
    expect(rule.matcher.subject?.regexIsh).toBe('invoice|számla')
    expect(rule.action).toEqual({
      type: 'delegate',
      to: 'finance@acme.example',
      template: 'FYI',
    })
    expect(rule.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(rule.source).toBe('original NL')
  })

  it('parses a simple archive rule', () => {
    const raw = JSON.stringify({
      label: 'Archive newsletters',
      matcher: { from: { contains: 'newsletter@' } },
      action: { type: 'archive' },
    })
    const rule = parseCompiledRule(raw, 'source')
    expect(rule.action.type).toBe('archive')
    expect(rule.matcher.from?.contains).toBe('newsletter@')
  })

  it('tolerates surrounding prose around the JSON', () => {
    const raw = `Here is the rule:\n${JSON.stringify({
      label: 'x',
      matcher: { subject: { contains: 'x' } },
      action: { type: 'archive' },
    })}\nHope this helps!`
    const rule = parseCompiledRule(raw, 'source')
    expect(rule.label).toBe('x')
  })

  it('throws when JSON is missing', () => {
    expect(() => parseCompiledRule('not json', 'src')).toThrow(RuleCompilationError)
  })

  it('throws when JSON is syntactically invalid', () => {
    expect(() => parseCompiledRule('{ bad json }', 'src')).toThrow(RuleCompilationError)
  })

  it('throws when the label is missing', () => {
    const raw = JSON.stringify({
      matcher: { subject: { contains: 'x' } },
      action: { type: 'archive' },
    })
    expect(() => parseCompiledRule(raw, 'src')).toThrow(/label/)
  })

  it('throws when no matcher clauses are present', () => {
    const raw = JSON.stringify({
      label: 'empty',
      matcher: {},
      action: { type: 'archive' },
    })
    expect(() => parseCompiledRule(raw, 'src')).toThrow(/matcher clauses/)
  })

  it('throws when a clause has no predicates', () => {
    const raw = JSON.stringify({
      label: 'bad clause',
      matcher: { subject: { caseInsensitive: true } },
      action: { type: 'archive' },
    })
    expect(() => parseCompiledRule(raw, 'src')).toThrow(/contains\/equals\/regexIsh/)
  })

  it('throws on invalid action type', () => {
    const raw = JSON.stringify({
      label: 'x',
      matcher: { subject: { contains: 'x' } },
      action: { type: 'nuke' },
    })
    expect(() => parseCompiledRule(raw, 'src')).toThrow(/action\.type/)
  })

  it('throws when delegate has no valid email target', () => {
    const raw = JSON.stringify({
      label: 'x',
      matcher: { subject: { contains: 'x' } },
      action: { type: 'delegate', to: 'not-an-email' },
    })
    expect(() => parseCompiledRule(raw, 'src')).toThrow(/action\.to/)
  })

  it('surfaces explicit error responses from the LLM', () => {
    const raw = JSON.stringify({ error: 'not a rule' })
    expect(() => parseCompiledRule(raw, 'src')).toThrow(/rejected input/)
  })

  it('rejects regexIsh patterns longer than 512 chars', () => {
    const long = 'a'.repeat(600)
    const raw = JSON.stringify({
      label: 'x',
      matcher: { subject: { regexIsh: long } },
      action: { type: 'archive' },
    })
    expect(() => parseCompiledRule(raw, 'src')).toThrow(/too long/)
  })
})

describe('RuleCompiler.compile', () => {
  it('compiles a natural-language rule end-to-end', async () => {
    const scripted = JSON.stringify({
      label: 'Forward GitHub PR pings',
      matcher: {
        from: { contains: 'notifications@github.com', caseInsensitive: true },
        subject: { regexIsh: 'pull request|pr #', caseInsensitive: true },
      },
      action: { type: 'delegate', to: 'team@eyas.example' },
    })
    const compiler = new RuleCompiler(new ScriptedLLM([scripted]))
    const rule = await compiler.compile(
      'Forward every GitHub pull request notification to team@eyas.example'
    )
    expect(rule.action.type).toBe('delegate')
    expect(rule.action.to).toBe('team@eyas.example')
    expect(rule.source).toContain('GitHub pull request')
  })

  it('rejects empty input', async () => {
    const compiler = new RuleCompiler(new ScriptedLLM(['{}']))
    await expect(compiler.compile('   ')).rejects.toThrow(/Empty/)
  })

  it('rejects overlong input', async () => {
    const compiler = new RuleCompiler(new ScriptedLLM(['{}']))
    await expect(compiler.compile('x'.repeat(1500))).rejects.toThrow(/too long/)
  })
})

describe('NaturalLanguageFilters', () => {
  it('persists compiled rules to the store', async () => {
    const store = new InMemoryRuleStore()
    const llm = new ScriptedLLM([
      JSON.stringify({
        label: 'archive all dev notifications',
        matcher: { from: { contains: 'devnews.example' } },
        action: { type: 'archive' },
      }),
    ])
    const filters = new NaturalLanguageFilters(store, llm)
    const rule = await filters.addFromNl('archive devnews newsletters')
    const list = await filters.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(rule.id)
    await filters.remove(rule.id)
    expect(await filters.list()).toHaveLength(0)
  })
})
