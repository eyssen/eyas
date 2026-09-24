// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { isMemoryIndexBasename, parseMemoryIndex } from '@modules/data-port/memory-index-hooks'

const INDEX = `# Memory Index
Globally shared. One line per entry.

## User
- [Senior dev at Alpha](user_profile.md) · [Grok + Claude shared setup](grok-claude-shared-setup.md)
## Feedback — Global (workflow rules)
- [Scan memory at task start](feedback_always_check_memory.md) · [No fluff](feedback_terse_output.md)
- Pod/local: [DEFAULT local](feedback_default_local_dev.md) · [pod mention ≠ write](feedback_pod_vs_local.md)
## Project — bravo
- [prefix-drop plan READY](project_prefix_plan.md)
- [second hook for same file](project_prefix_plan.md)
`

describe('memory index hooks', () => {
  it('recognises MEMORY.md by basename only', () => {
    expect(isMemoryIndexBasename('.grok/memory/MEMORY.md')).toBe(true)
    expect(isMemoryIndexBasename('ai-memory/memory.md')).toBe(true)
    expect(isMemoryIndexBasename('ai-memory/feedback_no_auto_commit.md')).toBe(false)
  })
  it('collects every hook per file with its section', () => {
    const r = parseMemoryIndex(INDEX)
    expect(r.count).toBe(8)
    expect(r.entries.get('user_profile')).toEqual({ hooks: ['Senior dev at Alpha'], section: 'User' })
    expect(r.entries.get('feedback_pod_vs_local')).toEqual({ hooks: ['pod mention ≠ write'], section: 'Feedback — Global (workflow rules)' })
    expect(r.entries.get('project_prefix_plan')).toEqual({ hooks: ['prefix-drop plan READY', 'second hook for same file'], section: 'Project — bravo' })
  })
  it('accepts wikilink-style indexes too', () => {
    const r = parseMemoryIndex('## A\n- [[alpha]] — first fact\n- [[beta|Beta note]]\n')
    expect(r.entries.get('alpha')).toEqual({ hooks: ['first fact'], section: 'A' })
    expect(r.entries.get('beta')).toEqual({ hooks: ['Beta note'], section: 'A' })
  })
  it('shares a trailing wikilink gloss with every link on the line that has no alias/gloss of its own', () => {
    const r = parseMemoryIndex('## A\n- [[alpha]] · [[beta]] — shared gloss\n- [[gamma|Gamma alias]] · [[delta]] — tail\n')
    expect(r.entries.get('alpha')).toEqual({ hooks: ['shared gloss'], section: 'A' })
    expect(r.entries.get('beta')).toEqual({ hooks: ['shared gloss'], section: 'A' })
    expect(r.entries.get('gamma')).toEqual({ hooks: ['Gamma alias'], section: 'A' })
    expect(r.entries.get('delta')).toEqual({ hooks: ['tail'], section: 'A' })
  })
  it('prefers a link\'s own trailing gloss over its own alias, even in last position', () => {
    // `[[x|Alias]]` is a display title for the link, not a hook; a dash-gloss right
    // after it is the actual hook and wins, exactly like any other own-gloss link.
    const withGloss = parseMemoryIndex('## A\n- [[x|Alias]] — note\n')
    expect(withGloss.entries.get('x')).toEqual({ hooks: ['note'], section: 'A' })
    // With no gloss at all, the alias is the only hook text available and is used.
    const noGloss = parseMemoryIndex('## A\n- [[x|Alias]]\n')
    expect(noGloss.entries.get('x')).toEqual({ hooks: ['Alias'], section: 'A' })
  })
})
