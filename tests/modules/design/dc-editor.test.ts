// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { DC_RUNTIME_SOURCE } from '@modules/design/dc-runtime-source'
import { isDcOutboundMessage, isFromFrame } from '@modules/design/dc-edit-protocol'

/**
 * The editing channel. The artboard runs in a sandbox with no
 * `allow-same-origin`, so the app cannot reach its DOM: every gesture crosses
 * postMessage, and the runtime — not the app — owns the template mutation.
 */
function mount(spec: Record<string, unknown>) {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="dc-root"></div>'
  const posted: any[] = []
  // eslint-disable-next-line no-new-func
  new Function(DC_RUNTIME_SOURCE)()
  const editor = (globalThis as any).__dcMountArtboard({ ...spec, post: (m: any) => posted.push(m) })
  return { editor, posted, root: document.getElementById('dc-root')! }
}

const edit = (editor: any) => (message: unknown) => editor.handle(message)
const lastOf = (posted: any[], type: string) => [...posted].reverse().find((m) => m.type === type)

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

describe('mode', () => {
  it('starts in interact mode so a prototype works out of the box', () => {
    const { root, posted } = mount({
      template: '<button onClick="{{go}}">{{n}}</button>',
      logic: 'class Component extends DCLogic { renderVals() { var s = this; return { n: this.state.n || 0, go: function () { s.setState({ n: (s.state.n || 0) + 1 }) } } } }',
    })
    root.querySelector('button')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(root.querySelector('button')!.textContent).toBe('1')
    expect(lastOf(posted, 'dc:selected')).toBeUndefined()
  })

  it('selects instead of interacting once edit mode is on', () => {
    const { root, posted, editor } = mount({
      template: '<button onClick="{{go}}">{{n}}</button>',
      logic: 'class Component extends DCLogic { renderVals() { var s = this; return { n: this.state.n || 0, go: function () { s.setState({ n: 1 }) } } } }',
    })
    edit(editor)({ type: 'dc:setMode', mode: 'edit' })
    root.querySelector('button')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(root.querySelector('button')!.textContent).toBe('0')
    expect(lastOf(posted, 'dc:selected')).toMatchObject({ index: 0, tag: 'button' })
  })

  it('clears the selection when returning to interact mode', () => {
    const { root, editor } = mount({ template: '<p>x</p>', logic: null })
    edit(editor)({ type: 'dc:setMode', mode: 'edit' })
    edit(editor)({ type: 'dc:select', index: 0 })
    expect(root.querySelector('[data-dc-selected]')).not.toBeNull()
    edit(editor)({ type: 'dc:setMode', mode: 'interact' })
    expect(root.querySelector('[data-dc-selected]')).toBeNull()
  })
})

describe('selection', () => {
  it('reports the tag, the authored inline styles and the text', () => {
    const { posted, editor } = mount({
      template: '<div style="padding: 16px; color: #101114"><span>Label</span></div>',
      logic: null,
    })
    edit(editor)({ type: 'dc:select', index: 1 })
    expect(lastOf(posted, 'dc:selected')).toMatchObject({
      index: 1, tag: 'span', text: 'Label', bound: false,
    })
    edit(editor)({ type: 'dc:select', index: 0 })
    expect(lastOf(posted, 'dc:selected').styles).toEqual({ padding: '16px', color: '#101114' })
  })

  it('marks bound text as not editable in place', () => {
    const { posted, editor } = mount({
      template: '<p>{{ user.name }}</p>',
      logic: 'class Component extends DCLogic { renderVals() { return { user: { name: "Ada" } } } }',
    })
    edit(editor)({ type: 'dc:select', index: 0 })
    expect(lastOf(posted, 'dc:selected').bound).toBe(true)
  })

  it('paints exactly one selection outline', () => {
    const { root, editor } = mount({ template: '<div><i>a</i><b>c</b></div>', logic: null })
    edit(editor)({ type: 'dc:select', index: 1 })
    edit(editor)({ type: 'dc:select', index: 2 })
    expect(root.querySelectorAll('[data-dc-selected]')).toHaveLength(1)
    expect(root.querySelector('[data-dc-selected]')!.tagName.toLowerCase()).toBe('b')
  })
})

describe('style patching', () => {
  it('posts back source with the property changed', () => {
    const { posted, editor } = mount({ template: '<p style="color: #000">x</p>', logic: null })
    edit(editor)({ type: 'dc:setStyle', index: 0, styles: { color: '#f00' } })
    const src = lastOf(posted, 'dc:source')
    expect(src.body).toContain('style="color: #f00"')
    expect(src.body).not.toContain('data-dc-i')
  })

  it('adds a property that was not there', () => {
    const { posted, editor } = mount({ template: '<p>x</p>', logic: null })
    edit(editor)({ type: 'dc:setStyle', index: 0, styles: { 'font-size': '18px' } })
    expect(lastOf(posted, 'dc:source').body).toContain('style="font-size: 18px"')
  })

  it('removes a property on null and drops an empty style attribute', () => {
    const { posted, editor } = mount({ template: '<p style="color: #000">x</p>', logic: null })
    edit(editor)({ type: 'dc:setStyle', index: 0, styles: { color: null } })
    expect(lastOf(posted, 'dc:source').body).not.toContain('style=')
  })

  it('PRESERVES a {{hole}} in a declaration it was not asked to touch', () => {
    const { posted, editor } = mount({
      template: '<p style="color: {{accent}}; padding: 4px">x</p>',
      logic: 'class Component extends DCLogic { renderVals() { return { accent: "#b45309" } } }',
    })
    edit(editor)({ type: 'dc:setStyle', index: 0, styles: { padding: '12px' } })
    const body = lastOf(posted, 'dc:source').body
    expect(body).toContain('color: {{accent}}')
    expect(body).toContain('padding: 12px')
  })

  it('keeps declaration order stable', () => {
    const { posted, editor } = mount({ template: '<p style="a: 1; b: 2; c: 3">x</p>', logic: null })
    edit(editor)({ type: 'dc:setStyle', index: 0, styles: { b: '9' } })
    expect(lastOf(posted, 'dc:source').body).toContain('style="a: 1; b: 9; c: 3"')
  })

  it('re-renders the artboard with the new style', () => {
    const { root, editor } = mount({ template: '<p style="color: #000">x</p>', logic: null })
    edit(editor)({ type: 'dc:setStyle', index: 0, styles: { color: '#f00' } })
    expect(root.querySelector('p')!.getAttribute('style')).toContain('#f00')
  })

  it('ignores an index that does not exist', () => {
    const { posted, editor } = mount({ template: '<p>x</p>', logic: null })
    edit(editor)({ type: 'dc:setStyle', index: 99, styles: { color: '#f00' } })
    expect(lastOf(posted, 'dc:source')).toBeUndefined()
  })
})

describe('text patching', () => {
  it('replaces the text and posts back source', () => {
    const { posted, root, editor } = mount({ template: '<h1>Old</h1>', logic: null })
    edit(editor)({ type: 'dc:setText', index: 0, text: 'New heading' })
    expect(lastOf(posted, 'dc:source').body).toContain('<h1>New heading</h1>')
    expect(root.querySelector('h1')!.textContent).toBe('New heading')
  })

  it('escapes markup in the new text rather than injecting it', () => {
    const { posted, root, editor } = mount({ template: '<p>x</p>', logic: null })
    edit(editor)({ type: 'dc:setText', index: 0, text: '<script>alert(1)</script>' })
    expect(root.querySelector('script')).toBeNull()
    expect(lastOf(posted, 'dc:source').body).toContain('&lt;script&gt;')
  })
})

describe('tweaks', () => {
  it('re-renders live when props change', () => {
    const { root, editor } = mount({
      template: '<p style="color: {{accent}}">x</p>',
      defaults: { accent: '#000000' },
      logic: 'class Component extends DCLogic { renderVals() { return { accent: this.props.accent } } }',
    })
    expect(root.querySelector('p')!.getAttribute('style')).toContain('#000000')
    edit(editor)({ type: 'dc:setProps', props: { accent: '#0a2540' } })
    expect(root.querySelector('p')!.getAttribute('style')).toContain('#0a2540')
  })
})

describe('protocol guards', () => {
  it('accepts well-formed outbound messages', () => {
    expect(isDcOutboundMessage({ type: 'dc:height', height: 400 })).toBe(true)
    expect(isDcOutboundMessage({ type: 'dc:selected', index: 0, tag: 'p', styles: {} })).toBe(true)
    expect(isDcOutboundMessage({ type: 'dc:source', body: '<p/>', index: null })).toBe(true)
  })

  it('rejects malformed or hostile shapes', () => {
    expect(isDcOutboundMessage(null)).toBe(false)
    expect(isDcOutboundMessage({ type: 'dc:height', height: -1 })).toBe(false)
    expect(isDcOutboundMessage({ type: 'dc:selected', index: -1, tag: 'p', styles: {} })).toBe(false)
    expect(isDcOutboundMessage({ type: 'dc:selected', index: 0, tag: 'p', styles: { a: 1 } })).toBe(false)
    expect(isDcOutboundMessage({ type: 'dc:source', body: 42, index: null })).toBe(false)
    expect(isDcOutboundMessage({ type: 'dc:evil', body: 'x' })).toBe(false)
  })

  it('attributes a message to the artboard frame and no other window', () => {
    const frame = { contentWindow: { id: 'mine' } } as any
    expect(isFromFrame({ source: frame.contentWindow }, frame)).toBe(true)
    expect(isFromFrame({ source: { id: 'someone-else' } }, frame)).toBe(false)
    expect(isFromFrame({ source: null }, null)).toBe(false)
  })
})
