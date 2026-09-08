// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { DC_RUNTIME_SOURCE } from '@modules/design/dc-runtime-source'

/**
 * The runtime ships as a string because it executes inside the artboard's
 * sandboxed iframe. That makes it exactly the piece most easily left untested,
 * so it is evaluated here against a real DOM and driven through the format's
 * documented semantics — including the ones that fail SILENTLY in production.
 */
declare global {
  // eslint-disable-next-line no-var
  var __dcMountArtboard: (spec: any) => void
  // eslint-disable-next-line no-var
  var __dcInternals: { lookup: (s: any, e: string) => unknown; interpolate: (t: string, s: any) => string; attrValue: (r: string, s: any) => unknown }
}

function loadRuntime() {
  document.head.innerHTML = ''
  document.body.innerHTML = '<div id="dc-root"></div>'
  // eslint-disable-next-line no-new-func
  new Function(DC_RUNTIME_SOURCE)()
}

function mount(spec: Record<string, unknown>) {
  loadRuntime()
  ;(globalThis as any).__dcMountArtboard(spec)
  return document.getElementById('dc-root')!
}

const logic = (body: string) => `class Component extends DCLogic { ${body} }`

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

describe('holes', () => {
  it('resolves a dotted path in text', () => {
    const root = mount({
      template: '<p>{{ user.name }}</p>',
      logic: logic('renderVals() { return { user: { name: "Ada" } } }'),
    })
    expect(root.textContent).toBe('Ada')
  })

  it('renders nothing for a missing path rather than throwing', () => {
    const root = mount({ template: '<p>[{{ nope.deep.deeper }}]</p>', logic: logic('renderVals() { return {} }') })
    expect(root.textContent).toBe('[]')
  })

  it('renders an expression hole as empty — it is a lookup, not an expression', () => {
    const root = mount({ template: '<p>[{{ a + b }}]</p>', logic: logic('renderVals() { return { a: 1, b: 2 } }') })
    expect(root.textContent).toBe('[]')
  })

  it('supports literal holes', () => {
    const root = mount({ template: '<p>{{ true }}|{{ 42 }}</p>', logic: logic('renderVals() { return {} }') })
    expect(root.textContent).toBe('true|42')
  })

  it('leaves an operator OUTSIDE the braces as literal text', () => {
    const root = mount({ template: '<p>{{x}} ? a : b</p>', logic: logic('renderVals() { return { x: "V" } }') })
    expect(root.textContent).toBe('V ? a : b')
  })
})

describe('attributes', () => {
  it('interpolates a mixed attribute into a string', () => {
    const root = mount({ template: '<i title="a {{p}} b"></i>', logic: logic('renderVals() { return { p: "X" } }') })
    expect(root.querySelector('i')!.getAttribute('title')).toBe('a X b')
  })

  it('passes a whole-value hole through as the raw value', () => {
    const root = mount({ template: '<i data-n="{{n}}"></i>', logic: logic('renderVals() { return { n: 7 } }') })
    expect(root.querySelector('i')!.getAttribute('data-n')).toBe('7')
  })

  it('omits an attribute whose value is false, null or undefined', () => {
    const root = mount({ template: '<i data-a="{{f}}" data-b="{{missing}}"></i>', logic: logic('renderVals() { return { f: false } }') })
    const el = root.querySelector('i')!
    expect(el.hasAttribute('data-a')).toBe(false)
    expect(el.hasAttribute('data-b')).toBe(false)
  })

  it('maps className and htmlFor', () => {
    const root = mount({ template: '<label className="lbl" htmlFor="x">L</label>', logic: logic('renderVals() { return {} }') })
    const el = root.querySelector('label')!
    expect(el.getAttribute('class')).toBe('lbl')
    expect(el.getAttribute('for')).toBe('x')
  })
})

describe('sc-for and sc-if', () => {
  it('repeats with the alias and $index in scope', () => {
    const root = mount({
      template: '<ul><sc-for list="{{items}}" as="item"><li>{{$index}}:{{item.label}}</li></sc-for></ul>',
      logic: logic('renderVals() { return { items: [{ label: "a" }, { label: "b" }] } }'),
    })
    expect([...root.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['0:a', '1:b'])
  })

  it('falls back to hint-placeholder-count when the list is not an array', () => {
    const root = mount({
      template: '<sc-for list="{{missing}}" as="i" hint-placeholder-count="3"><b>x</b></sc-for>',
      logic: logic('renderVals() { return {} }'),
    })
    expect(root.querySelectorAll('b')).toHaveLength(3)
  })

  it('branches on sc-if', () => {
    const yes = mount({ template: '<sc-if value="{{c}}"><b>y</b></sc-if>', logic: logic('renderVals() { return { c: true } }') })
    expect(yes.querySelector('b')).not.toBeNull()
    const no = mount({ template: '<sc-if value="{{c}}"><b>y</b></sc-if>', logic: logic('renderVals() { return { c: false } }') })
    expect(no.querySelector('b')).toBeNull()
  })

  it('nests a loop inside a branch', () => {
    const root = mount({
      template: '<sc-if value="{{on}}"><sc-for list="{{xs}}" as="x"><i>{{x}}</i></sc-for></sc-if>',
      logic: logic('renderVals() { return { on: true, xs: [1, 2] } }'),
    })
    expect([...root.querySelectorAll('i')].map((e) => e.textContent)).toEqual(['1', '2'])
  })
})

describe('events and state', () => {
  it('binds onClick from renderVals and re-renders on setState', () => {
    const root = mount({
      template: '<button onClick="{{bump}}">{{count}}</button>',
      logic: logic(`
        renderVals() {
          var self = this
          return { count: this.state.count || 0, bump: function () { self.setState({ count: (self.state.count || 0) + 1 }) } }
        }
      `),
    })
    const btn = () => root.querySelector('button')!
    expect(btn().textContent).toBe('0')
    btn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(btn().textContent).toBe('1')
    btn().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect(btn().textContent).toBe('2')
  })

  it('supports a per-item handler attached in renderVals', () => {
    const root = mount({
      template: '<sc-for list="{{items}}" as="item"><b onClick="{{item.pick}}">{{item.id}}{{item.mark}}</b></sc-for>',
      logic: logic(`
        renderVals() {
          var self = this
          var picked = this.state.picked
          return {
            items: [1, 2].map(function (id) {
              return { id: id, mark: picked === id ? '*' : '', pick: function () { self.setState({ picked: id }) } }
            }),
          }
        }
      `),
    })
    const second = () => root.querySelectorAll('b')[1]
    second().dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    expect([...root.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['1', '2*'])
  })

  it('runs componentDidMount', () => {
    const root = mount({
      template: '<p>{{v}}</p>',
      logic: logic(`
        renderVals() { return { v: this.state.v || 'before' } }
        componentDidMount() { this.setState({ v: 'after' }) }
      `),
    })
    expect(root.textContent).toBe('after')
  })
})

describe('props and defaults', () => {
  it('merges declared defaults under supplied props', () => {
    const root = mount({
      template: '<p>{{a}}|{{b}}</p>',
      defaults: { a: 'da', b: 'db' },
      props: { b: 'pb' },
      logic: logic('renderVals() { return { a: this.props.a, b: this.props.b } }'),
    })
    expect(root.textContent).toBe('da|pb')
  })

  it('exposes props and state as scope roots even with no renderVals', () => {
    const root = mount({ template: '<p>{{props.tint}}</p>', props: { tint: '#abc' }, logic: null })
    expect(root.textContent).toBe('#abc')
  })
})

describe('dc-import', () => {
  it('mounts a sibling artboard and passes attributes as camelCase props', () => {
    const root = mount({
      template: '<dc-import name="Card" item-label="{{label}}" hint-size="100%,120px"></dc-import>',
      logic: logic('renderVals() { return { label: "Hello" } }'),
      imports: { Card: { template: '<span>{{props.itemLabel}}</span>', logic: null, defaults: {} } },
    })
    expect(root.querySelector('span')!.textContent).toBe('Hello')
    expect((root.querySelector('[data-dc-import]') as HTMLElement).style.height).toBe('120px')
  })

  it('renders a visible placeholder for a missing component', () => {
    const root = mount({ template: '<dc-import name="Ghost"></dc-import>', logic: null })
    expect(root.querySelector('[data-dc-missing]')!.textContent).toContain('Ghost')
  })
})

describe('failure containment', () => {
  it('shows the error instead of blanking when the logic will not compile', () => {
    const root = mount({ template: '<p>x</p>', logic: 'class Component extends DCLogic { !!! }' })
    expect(root.getAttribute('data-dc-error')).toBe('1')
    expect(root.textContent).toContain('failed to compile')
  })

  it('shows the error when renderVals throws', () => {
    const root = mount({ template: '<p>x</p>', logic: logic('renderVals() { throw new Error("boom") }') })
    expect(root.textContent).toContain('boom')
  })

  it('reports logic that defines no Component class', () => {
    const root = mount({ template: '<p>x</p>', logic: 'var notAComponent = 1' })
    expect(root.textContent).toContain('did not define')
  })
})

describe('images and helmet', () => {
  it('substitutes bare filenames with their data URIs', () => {
    const root = mount({
      template: '<img src="logo.png"><i style="background:url(./bg.jpg)"></i>',
      logic: null,
      images: { 'logo.png': 'data:image/png;base64,AAA', 'bg.jpg': 'data:image/jpeg;base64,BBB' },
    })
    expect(root.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAA')
    expect(root.querySelector('i')!.getAttribute('style')).toContain('data:image/jpeg;base64,BBB')
  })

  it('moves helmet content into head but never a script', () => {
    mount({
      template: '<p>x</p>',
      logic: null,
      helmet: '<style id="h">body{margin:0}</style><script>window.__pwned = 1</script>',
    })
    expect(document.head.querySelector('#h')).not.toBeNull()
    expect(document.head.querySelector('script')).toBeNull()
    expect((window as any).__pwned).toBeUndefined()
  })
})

describe('exposed internals', () => {
  it('lookup handles literals, paths and misses', () => {
    loadRuntime()
    const { lookup } = (globalThis as any).__dcInternals
    expect(lookup({ a: { b: 2 } }, 'a.b')).toBe(2)
    expect(lookup({}, 'true')).toBe(true)
    expect(lookup({}, 'a.b')).toBeUndefined()
    expect(lookup({}, 'fn()')).toBeUndefined()
  })
})
