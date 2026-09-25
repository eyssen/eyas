// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A2 — a project needs no working directories: a conversation without folders
// works in its own EYAS workspace. The project form saves such a project.

import { describe, it, expect } from 'vitest'
import { canSaveProject, projectSavePayload, type ProjectForm } from '@/pages/projects/project-form'
import en from '@/pages/projects/locales/en.json'
import hu from '@/pages/projects/locales/hu.json'
import de from '@/pages/projects/locales/de.json'
import es from '@/pages/projects/locales/es.json'
import fr from '@/pages/projects/locales/fr.json'
import tlh from '@/pages/projects/locales/tlh.json'

function form(over: Partial<ProjectForm> = {}): ProjectForm {
  return {
    name: 'alpha', typeId: '', description: '', prompt: '', color: '', defaultAgentId: 'agent-1',
    indexedSourceIds: [], workingDirectories: [{ name: '', path: '' }],
    defaultConnectionId: '', ticketConnectionId: '',
    wikiAutoTickets: false, wikiAutoDecisions: false, wikiTicketBody: 'title',
    ...over,
  }
}

describe('project form save', () => {
  it('(+) a project with no directories can be saved; its payload sends an empty folder list', () => {
    const f = form()
    expect(canSaveProject(f)).toBe(true)
    expect(projectSavePayload(f)).toMatchObject({ name: 'alpha', defaultAgentId: 'agent-1', workingDirectories: [] })
    expect(projectSavePayload(form({ workingDirectories: [] })).workingDirectories).toEqual([])
  })

  it('(+) directories that are set are sent; blank rows are dropped', () => {
    const p = projectSavePayload(form({ workingDirectories: [{ name: '', path: ' /srv/app ' }, { name: 'x', path: '  ' }] }))
    expect(p.workingDirectories).toEqual(['/srv/app'])
  })

  it('(−) a name and a default agent are still required', () => {
    expect(canSaveProject(form({ name: '  ' }))).toBe(false)
    expect(canSaveProject(form({ defaultAgentId: '' }))).toBe(false)
  })

  it('(−) no locale marks the field as required or keeps the "required" message', () => {
    for (const bundle of [en, hu, de, es, fr, tlh] as Array<Record<string, string>>) {
      expect(bundle['projects.form.workingDirs']).not.toMatch(/\*\s*$/)
      expect(bundle['projects.form.workingDirsRequired']).toBeUndefined()
      expect(bundle['projects.form.workingDirsSeedHint']).toMatch(/EYAS/)
    }
  })
})
