// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D-7 / P-19 on the widest consumer in the inventory. The skills section names
// every enabled skill in the assembled system prompt on every turn and carries
// its DESCRIPTION, so an imported skill whose frontmatter description holds a
// credential reaches the model with no match and no click. This is the
// regression cover for that.
//
// The source's `?? s.content` fallback is dead through the loader as it stands
// (see the header of skills-section.ts); the case below pins that, so nobody
// inherits a leak path that does not exist and anyone who makes it live is
// told the test now matters.

import { describe, it, expect } from 'vitest'
import { resolveSkillSectionLines } from '@modules/prompt-wizard/skills-section'

const KEY = 'alphabravocharlie0001'
const flagged = {
  name: 'alpha deploy',
  content: `Run the alpha deploy with PGPASSWORD=${KEY}`,
  capabilities: ['imported', 'contains-secrets'],
}
const plain = { name: 'bravo deploy', content: 'Run the bravo deploy', capabilities: ['imported'] }

function svc(includeSecrets: boolean | undefined) {
  return {
    loader: { list: () => [flagged, plain] },
    ...(includeSecrets === undefined ? {} : { recall: () => ({ includeSecrets }) }),
  }
}

describe('resolveSkillSectionLines', () => {
  it('keeps a flagged skill out of the prompt section by default', () => {
    const lines = resolveSkillSectionLines(svc(false))
    expect(lines.map((l) => l.name)).toEqual(['bravo deploy'])
    expect(JSON.stringify(lines)).not.toContain(KEY)
  })

  it('includes it once the owner opened memory.recall.includeSecrets', () => {
    const lines = resolveSkillSectionLines(svc(true))
    expect(lines.map((l) => l.name)).toEqual(['alpha deploy', 'bravo deploy'])
    expect(JSON.stringify(lines)).toContain(KEY)
  })

  it('fails closed when no recall accessor is wired', () => {
    const lines = resolveSkillSectionLines(svc(undefined))
    expect(lines.map((l) => l.name)).toEqual(['bravo deploy'])
  })

  it('is the DESCRIPTION that reaches the prompt — the real leak vector for an imported skill', () => {
    // This is the case that matters. An imported skill's frontmatter
    // description can hold a credential just as its body can, and the
    // description is what the section actually carries.
    const leaky = {
      name: 'echo deploy',
      description: `Deploy echo with PGPASSWORD=${KEY}`,
      content: 'body',
      capabilities: ['imported', 'contains-secrets'],
    }
    const list = () => [leaky]
    expect(resolveSkillSectionLines({ loader: { list } })).toEqual([])
    expect(resolveSkillSectionLines({ loader: { list }, recall: () => ({ includeSecrets: true }) })[0].oneLine)
      .toContain(KEY)
  })

  it('emits an empty line, NOT the body head, for the shape the loader really produces', () => {
    // skill-loader.ts:68 maps `description: raw.description ?? ''`, and every
    // insert and update writes `''` for a missing description, so a
    // description-less skill arrives with an empty string. `??` falls back on
    // null/undefined only, so `(s.description ?? s.content ?? '')` yields ''.
    // The content-head path is therefore UNREACHABLE through the loader today.
    // Asserted as it is rather than as the comment used to claim, so nobody
    // inherits a leak path that does not exist — and so that anyone who makes
    // the fallback live (`||` instead of `??`) is told this test now matters.
    const asStored = { name: 'delta', description: '', content: `body head with ${KEY}` }
    expect(resolveSkillSectionLines({ loader: { list: () => [asStored] }, recall: () => ({ includeSecrets: true }) })[0].oneLine)
      .toBe('')

    const described = { name: 'charlie', description: 'Does the charlie thing', content: `secret ${KEY}` }
    expect(resolveSkillSectionLines({ loader: { list: () => [described] }, recall: () => ({ includeSecrets: true }) })[0].oneLine)
      .toBe('Does the charlie thing')
  })

  it('is a section-less turn, never a failed one, when the service is absent or throws', () => {
    expect(resolveSkillSectionLines(undefined)).toEqual([])
    expect(resolveSkillSectionLines({})).toEqual([])
    expect(resolveSkillSectionLines({ loader: { list: () => { throw new Error('skills on fire') } } })).toEqual([])
  })
})
