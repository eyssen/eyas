// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/design-tools.ts
//
// The tools an agent uses to work with designs from inside a conversation.
//
// `category: 'custom'` throughout, so both MCP bridges pass them to the CLI
// providers — the bridges filter out only 'shell' and 'browser', and a design
// tool that does not exist on claude-code is a design tool that does not exist
// where most of the coding happens.
//
// `design_write` goes through the same validator gate as every other path, so
// an agent cannot store a canvas that will not open.

import { HtmlDocumentError, renderHtmlDocument } from '@shared/html-document.js'
import type { ToolImplementation } from '@modules/tools/types.js'
import type { DesignService } from './design-service.js'
import { ARTBOARD_ROLES, buildDesignIndex, renderDesignPart, type ArtboardRole } from './design-index.js'
import { DesignValidationError } from './design-service.js'

export interface DesignToolDeps {
  designs: () => DesignService | undefined
}

const NOT_READY = { error: 'Design module not ready yet — try again shortly' }

/** The only two things a design may be attached to. */
const LINK_SCOPES = { conversation: 'conversations', project: 'projects' } as const
type LinkScope = keyof typeof LINK_SCOPES

interface LinkTarget { scope: LinkScope; ownerModule: string; ownerId: string }

/**
 * Where a link goes. The owner module is a NAMESPACE, not a free string: the
 * model must not be able to invent one and file a link somewhere nothing will
 * ever read it. The id defaults to the run's own conversation or project, which
 * comes from the tool context rather than from the model.
 */
function resolveLinkTarget(input: Record<string, unknown>, ctx: any): LinkTarget | { error: string } {
  const raw = input.scope === undefined ? 'conversation' : String(input.scope)
  if (!(raw in LINK_SCOPES)) {
    return { error: `scope must be one of: ${Object.keys(LINK_SCOPES).join(', ')}` }
  }
  const scope = raw as LinkScope
  const fallback = scope === 'project' ? ctx?.projectId : ctx?.conversationId
  const ownerId = input.targetId !== undefined ? String(input.targetId) : (fallback ?? null)
  if (!ownerId) {
    return { error: `no ${scope} to attach to — pass targetId` }
  }
  return { scope, ownerModule: LINK_SCOPES[scope], ownerId: String(ownerId) }
}

export function createDesignTools(deps: DesignToolDeps): ToolImplementation[] {
  return [
    {
      name: 'design_list',
      description: 'List stored design canvases: id, title, kind and version. Use it to find a design before reading or editing it.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Filter by kind: ui, landing, print, deck, wireframe, freeform' },
          ownerId: { type: 'string', description: 'Only designs linked to this owner (used with ownerModule)' },
          ownerModule: { type: 'string', description: 'Owner module for the link filter, e.g. conversations' },
        },
        required: [],
      },
      execute: async (input) => {
        const svc = deps.designs()
        if (!svc) return NOT_READY
        if (input.ownerModule && input.ownerId) {
          return { designs: svc.linkedTo(String(input.ownerModule), String(input.ownerId)) }
        }
        return { designs: svc.list(input.kind ? { kind: input.kind as any } : undefined) }
      },
    },
    {
      name: 'design_read',
      description: 'Read a design. Give `part` (tokens, typography, components, patterns, page) for the derived values of that part — small, and usually all you need. Give `file` for one artboard’s full markup. Give neither only when you really need the whole canvas.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          designId: { type: 'string', description: 'The design id' },
          part: {
            type: 'string',
            enum: [...ARTBOARD_ROLES],
            description: 'Return the derived values for this part only — the cheap, usual read',
          },
          file: { type: 'string', description: 'Return one artboard’s full source' },
        },
        required: ['designId'],
      },
      execute: async (input) => {
        const svc = deps.designs()
        if (!svc) return NOT_READY
        const design = svc.get(String(input.designId))
        if (!design) return { error: `Design not found: ${String(input.designId)}` }
        // A part before a file, and a file before the whole canvas: cheapest
        // answer that can be correct. The part view is the SAME derivation the
        // per-turn announcement is built from, so the two cannot disagree
        // about what exists.
        if (input.part) {
          const role = String(input.part) as ArtboardRole
          if (!(ARTBOARD_ROLES as readonly string[]).includes(role)) {
            return { error: `Unknown part "${role}". Use one of: ${ARTBOARD_ROLES.join(', ')}` }
          }
          const rendered = renderDesignPart(design, buildDesignIndex(design), role)
          if (!rendered) {
            return { error: `This design has no "${role}" artboards. It has: ${design.artboards.join(', ')}` }
          }
          return { part: role, content: rendered }
        }
        if (input.file) {
          const content = design.files[String(input.file)]
          if (content === undefined) return { error: `No file named ${String(input.file)} in this design` }
          return { file: input.file, content }
        }
        const files: Record<string, string> = {}
        for (const [name, content] of Object.entries(design.files)) {
          files[name] = name.endsWith('.dc.html') || name === 'canvas.json'
            ? content
            : `<${content.length} bytes of base64 — reference it as "${name}">`
        }
        return {
          design: { id: design.id, title: design.title, kind: design.kind, version: design.currentVersion, artboards: design.artboards },
          files,
        }
      },
    },
    {
      name: 'design_write',
      description: 'Replace the files of a design canvas. Send every file the canvas should contain afterwards — an omitted file is deleted. The canvas is validated before it is stored; an invalid canvas is rejected and the previous version is kept.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          designId: { type: 'string', description: 'The design id' },
          files: { type: 'object', description: 'Map of file name to full file content' },
          note: { type: 'string', description: 'Short description of the change, stored on the version' },
        },
        required: ['designId', 'files'],
      },
      execute: async (input, ctx) => {
        const svc = deps.designs()
        if (!svc) return NOT_READY
        const files = input.files as Record<string, unknown> | undefined
        if (!files || typeof files !== 'object') return { error: 'files must be an object mapping file names to content' }
        const clean: Record<string, string> = {}
        for (const [name, content] of Object.entries(files)) {
          if (typeof content !== 'string') return { error: `"${name}" is not a string` }
          if (name.includes('/') || name.includes('\\') || name.includes('..')) return { error: `unsafe file name: ${name}` }
          clean[name] = content
        }
        try {
          const design = svc.writeFiles(String(input.designId), clean, {
            actor: ctx?.agentId ?? ctx?.userId,
            origin: 'ai',
            note: input.note ? String(input.note) : 'edited by agent',
          })
          return { ok: true, design: { id: design.id, version: design.currentVersion, artboards: design.artboards } }
        } catch (err) {
          if (err instanceof DesignValidationError) {
            return { error: 'The canvas was rejected and nothing was stored. Fix these and try again:', issues: err.result.errors }
          }
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    },
    {
      name: 'design_create',
      description: 'Create a new design canvas from a complete files record. The same validation applies as for design_write.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Human title for the design' },
          kind: { type: 'string', description: 'ui, landing, print, deck, wireframe or freeform' },
          files: { type: 'object', description: 'Map of file name to full file content; must include at least one <Name>.dc.html' },
        },
        required: ['title', 'files'],
      },
      execute: async (input, ctx) => {
        const svc = deps.designs()
        if (!svc) return NOT_READY
        const files = input.files as Record<string, unknown> | undefined
        if (!files || typeof files !== 'object') return { error: 'files must be an object mapping file names to content' }
        const clean: Record<string, string> = {}
        for (const [name, content] of Object.entries(files)) {
          if (typeof content !== 'string') return { error: `"${name}" is not a string` }
          if (name.includes('/') || name.includes('\\') || name.includes('..')) return { error: `unsafe file name: ${name}` }
          clean[name] = content
        }
        try {
          const design = svc.create({
            title: String(input.title),
            kind: input.kind as any,
            files: clean,
            origin: 'ai',
            actor: ctx?.agentId ?? ctx?.userId,
          })
          if (ctx?.conversationId) svc.link(design.id, 'conversations', ctx.conversationId, 'ai')
          return { ok: true, design: { id: design.id, title: design.title, artboards: design.artboards } }
        } catch (err) {
          if (err instanceof DesignValidationError) {
            return { error: 'The canvas was rejected and nothing was stored. Fix these and try again:', issues: err.result.errors }
          }
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    },
    {
      name: 'render_html_document',
      description: 'Turn Markdown into a self-contained, styled HTML document — a page or an email body. Send MARKDOWN, never HTML: the renderer owns the markup and refuses input that already contains tags.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'The content, as Markdown or plain text' },
          title: { type: 'string', description: 'Optional heading, also used as the email subject' },
          footer: { type: 'string', description: 'Optional small print under a rule' },
          flavour: { type: 'string', description: "'page' (default) or 'email' — email uses inline styles only" },
        },
        required: ['body'],
      },
      execute: async (input) => {
        try {
          const out = renderHtmlDocument(
            {
              body: String(input.body ?? ''),
              ...(input.title ? { title: String(input.title) } : {}),
              ...(input.footer ? { footer: String(input.footer) } : {}),
            },
            input.flavour === 'email' ? 'email' : 'page',
          )
          return { html: out.html, text: out.text, ...(out.subject ? { subject: out.subject } : {}) }
        } catch (err) {
          // The "you sent HTML" refusal is the useful half of this tool: it
          // tells the model exactly what to send instead.
          if (err instanceof HtmlDocumentError) return { error: err.message }
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
    },
    {
      name: 'design_link',
      description: 'Attach a design canvas to this conversation so its artboards travel with every turn, or attach it to a project so every conversation in that project inherits it.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          designId: { type: 'string', description: 'The design to attach' },
          scope: { type: 'string', description: "'conversation' (default) or 'project'" },
          targetId: { type: 'string', description: 'Conversation or project id; defaults to the one this run belongs to' },
        },
        required: ['designId'],
      },
      execute: async (input, ctx?: any) => {
        const svc = deps.designs()
        if (!svc) return NOT_READY
        const target = resolveLinkTarget(input, ctx)
        if ('error' in target) return target
        // Check the design exists first: a link to nothing is invisible until
        // someone wonders why the context is empty.
        if (!svc.get(String(input.designId))) return { error: `no design with id ${String(input.designId)}` }
        svc.link(String(input.designId), target.ownerModule, target.ownerId, 'ai')
        return { ok: true, attachedTo: { scope: target.scope, id: target.ownerId } }
      },
    },
    {
      name: 'design_unlink',
      description: 'Detach a design canvas from this conversation or from a project. The design itself is kept.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          designId: { type: 'string', description: 'The design to detach' },
          scope: { type: 'string', description: "'conversation' (default) or 'project'" },
          targetId: { type: 'string', description: 'Conversation or project id; defaults to the one this run belongs to' },
        },
        required: ['designId'],
      },
      execute: async (input, ctx?: any) => {
        const svc = deps.designs()
        if (!svc) return NOT_READY
        const target = resolveLinkTarget(input, ctx)
        if ('error' in target) return target
        svc.unlink(String(input.designId), target.ownerModule, target.ownerId)
        return { ok: true }
      },
    },
  ]
}
