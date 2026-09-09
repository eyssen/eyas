// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createKnowledgeTables } from './schema.js'
import { createKnowledgeService } from './knowledge-service.js'

const GETTING_STARTED_HTML = `
<h1>Welcome to Knowledge</h1>
<p>Knowledge is your personal wiki powered by the <strong>Saker editor</strong>. This page demonstrates all available content types.</p>

<h2>Text Formatting</h2>
<p>You can use <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strikethrough</s>, and <code>inline code</code> formatting. You can also add <a href="https://example.com">hyperlinks</a> with Ctrl+K.</p>

<h2>Headings</h2>
<h3>This is a Heading 3</h3>
<h4>This is a Heading 4</h4>
<p>Use <code>Ctrl+Alt+1</code> through <code>Ctrl+Alt+6</code> for heading levels, or type <code># </code> at the start of a line.</p>

<h2>Bullet List</h2>
<ul>
  <li>First item — type <code>- </code> or <code>* </code> to create a list</li>
  <li>Second item with <strong>bold</strong> and <em>italic</em></li>
  <li>Third item</li>
</ul>

<h2>Numbered List</h2>
<ol>
  <li>Step one — type <code>1. </code> to start a numbered list</li>
  <li>Step two</li>
  <li>Step three</li>
</ol>

<h2>Checklist</h2>
<ul class="saker-checklist">
  <li data-saker-checked="true">Set up the Knowledge module</li>
  <li data-saker-checked="true">Create your first page</li>
  <li data-saker-checked="false">Organize pages into spaces</li>
  <li data-saker-checked="false">Try all the editor features</li>
</ul>

<h2>Blockquote</h2>
<blockquote><p>The best way to predict the future is to invent it. — Alan Kay</p></blockquote>

<h2>Table</h2>
<table>
  <thead><tr><th>Feature</th><th>Shortcut</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td>Bold</td><td><code>Ctrl+B</code></td><td>Make text bold</td></tr>
    <tr><td>Italic</td><td><code>Ctrl+I</code></td><td>Make text italic</td></tr>
    <tr><td>Link</td><td><code>Ctrl+K</code></td><td>Insert hyperlink</td></tr>
    <tr><td>Undo</td><td><code>Ctrl+Z</code></td><td>Undo last change</td></tr>
    <tr><td>Slash menu</td><td><code>/</code></td><td>Open block insert menu</td></tr>
  </tbody>
</table>

<h2>Callouts</h2>
<div data-saker-block="callout" data-saker-props='{"type":"info","icon":"\\u2139\\uFE0F"}'><p>This is an <strong>info</strong> callout. Use it for general information and notes.</p></div>
<div data-saker-block="callout" data-saker-props='{"type":"tip","icon":"\\uD83D\\uDCA1"}'><p>This is a <strong>tip</strong> callout. Share useful advice and best practices.</p></div>
<div data-saker-block="callout" data-saker-props='{"type":"warning","icon":"\\u26A0\\uFE0F"}'><p>This is a <strong>warning</strong> callout. Alert users about potential issues.</p></div>
<div data-saker-block="callout" data-saker-props='{"type":"error","icon":"\\uD83D\\uDEAB"}'><p>This is an <strong>error</strong> callout. Highlight critical problems.</p></div>

<h2>Code Block</h2>
<pre data-saker-block="codeBlock" data-saker-props='{"language":"typescript"}'>function greet(name: string): string {
  return \`Hello, \${name}!\`
}

const result = greet("World")
console.log(result) // Hello, World!</pre>

<h2>Toggle / Expand</h2>
<details data-saker-block="toggle" data-saker-props='{"defaultOpen":false}'><summary>Click to expand this section</summary><div><p>This content is hidden by default. Toggle blocks are great for FAQs, spoilers, or secondary information that doesn't need to be visible at all times.</p></div></details>

<h2>Horizontal Rule</h2>
<p>Use <code>---</code> to insert a divider:</p>
<hr>

<h2>Slash Menu</h2>
<p>Type <code>/</code> at the start of an empty line to open the command menu. You can quickly insert any block type by searching.</p>

<h2>Keyboard Shortcuts</h2>
<table>
  <thead><tr><th>Category</th><th>Shortcut</th><th>Action</th></tr></thead>
  <tbody>
    <tr><td>Formatting</td><td><code>Ctrl+B / I / U</code></td><td>Bold / Italic / Underline</td></tr>
    <tr><td>Formatting</td><td><code>Ctrl+Shift+S</code></td><td>Strikethrough</td></tr>
    <tr><td>Formatting</td><td><code>Ctrl+E</code></td><td>Inline code</td></tr>
    <tr><td>Links</td><td><code>Ctrl+K</code></td><td>Insert / edit link</td></tr>
    <tr><td>Headings</td><td><code>Ctrl+Alt+1..6</code></td><td>Heading level 1-6</td></tr>
    <tr><td>History</td><td><code>Ctrl+Z / Shift+Z</code></td><td>Undo / Redo</td></tr>
    <tr><td>Save</td><td><code>Ctrl+S</code></td><td>Manual save</td></tr>
  </tbody>
</table>

<h2>Tips</h2>
<ul>
  <li>Click the page title above to rename it</li>
  <li>Content auto-saves 1 second after you stop typing</li>
  <li>Use the toolbar buttons or keyboard shortcuts for formatting</li>
  <li>The AI assistant can generate and edit pages too</li>
</ul>
`.trim()

const GETTING_STARTED_TEXT = `Welcome to Knowledge
Knowledge is your personal wiki.
Core Concepts: Spaces, Pages, Versions
Editor Features: rich formatting, keyboard shortcuts, slash commands
Tips: click title to rename, auto-save, AI editing`

export const knowledgeModule: EyasModule = {
  id: 'knowledge',
  name: 'Knowledge',
  version: '2.0.0',
  type: 'core',
  required: false,
  description: 'Wiki with Saker editor, hierarchical pages, real-time collaboration',
  dependencies: ['memory'],
  optional: ['conversations', 'model'],

  async onRegister(ctx: ModuleContext) {
    createKnowledgeTables(ctx.db)
    ctx.logger.info('Knowledge module registered (Saker editor)')
  },

  async onStart(ctx: ModuleContext) {
    const knowledgeService = createKnowledgeService(ctx.db)
    ;(ctx as any).knowledge = knowledgeService

    const wikilinks = (ctx as any)._wikilinks

    const { createKnowledgeRoutes } = await import('./routes.js')
    createKnowledgeRoutes(ctx.http, knowledgeService, wikilinks, ctx.logger)

    if (knowledgeService.listSpaces().length === 0) {
      const space = knowledgeService.createSpace({ name: 'General', slug: 'general', icon: '📝' })

      if (space) {
        ctx.logger.info('Created default "General" knowledge space')
        knowledgeService.createPage({
          spaceId: space.id,
          title: 'Getting Started',
          slug: 'getting-started',
          body: GETTING_STARTED_HTML,
          contentText: GETTING_STARTED_TEXT,
          icon: '📖',
          createdBy: 'system',
        })
        ctx.logger.info('Created "Getting Started" guide page')
      }
    }

    ctx.logger.info('Knowledge module started')
  },

  async onStop() {},
}
