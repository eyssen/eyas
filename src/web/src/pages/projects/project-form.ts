// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The project form's state and the body it saves. Working directories are
// optional: a conversation in a project without folders works in its own
// EYAS workspace, so an empty list is a valid save (the server then keeps
// the project type's list on create, or clears the project's own on edit).

import { payloadWorkingDirectories, type NamedWorkspace } from '@/components/working-directories-editor'

export interface ProjectForm {
  id?: string
  name: string
  typeId: string
  description: string
  prompt: string
  color: string
  defaultAgentId: string
  indexedSourceIds: string[]
  workingDirectories: NamedWorkspace[]
  defaultConnectionId: string
  ticketConnectionId: string
  wikiAutoTickets: boolean
  wikiAutoDecisions: boolean
  wikiTicketBody: 'title' | 'latest' | 'transcript'
  source?: 'seed' | 'user'
}

/** True when the form has what a save needs: a name and a default agent. */
export function canSaveProject(form: ProjectForm): boolean {
  return !!form.name.trim() && !!form.defaultAgentId
}

/** The POST/PATCH /projects body for the form. */
export function projectSavePayload(form: ProjectForm) {
  return {
    name: form.name.trim(),
    typeId: form.typeId || null,
    description: form.description.trim() || null,
    prompt: form.prompt.trim() || null,
    color: form.color.trim() || null,
    defaultAgentId: form.defaultAgentId,
    indexedSources: form.indexedSourceIds.length ? form.indexedSourceIds : null,
    workingDirectories: payloadWorkingDirectories(form.workingDirectories),
    defaultConnectionId: form.defaultConnectionId || null,
    ticketConnectionId: form.ticketConnectionId || null,
    wikiAutoTickets: form.wikiAutoTickets,
    wikiAutoDecisions: form.wikiAutoDecisions,
    wikiTicketBody: form.wikiTicketBody,
  }
}
