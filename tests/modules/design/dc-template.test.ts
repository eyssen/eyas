// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { parseArtboard, decodeAttribute, defaultProps, tweakableProps, DcParseError } from '@modules/design/dc-template'

const file = (body: string, script = '') => `<!doctype html>
<html><head><meta charset="utf-8"><script src="./support.js"></script></head>
<body>
<x-dc>
<helmet><style>body { margin: 0 } a { color: #b45309 }</style></helmet>
${body}
</x-dc>
${script}
</body></html>`

describe('parseArtboard', () => {
  it('splits helmet, template, props and logic', () => {
    const p = parseArtboard(file(
      '<h1 style="color: {{accent}}">Hi</h1>',
      `<script data-dc-script data-props='{"accent":{"editor":"color","default":"#b45309"}}'>
class Component extends DCLogic { renderVals() { return { accent: this.props.accent } } }
</script>`,
    ))
    expect(p.helmet).toContain('body { margin: 0 }')
    expect(p.template).toContain('<h1 style="color: {{accent}}">Hi</h1>')
    expect(p.template).not.toContain('<helmet>')
    expect(p.props.accent.editor).toBe('color')
    expect(p.logic).toContain('class Component extends DCLogic')
  })

  it('parses a static artboard with no script', () => {
    const p = parseArtboard(file('<div>static</div>'))
    expect(p.logic).toBeNull()
    expect(p.props).toEqual({})
  })

  it('parses an artboard with no helmet', () => {
    const p = parseArtboard('<x-dc><div>x</div></x-dc>')
    expect(p.helmet).toBe('')
    expect(p.template).toBe('<div>x</div>')
  })

  it('refuses a file with no <x-dc> root', () => {
    expect(() => parseArtboard('<html><body><div/></body></html>')).toThrow(DcParseError)
  })

  it('refuses an empty data-dc-script', () => {
    expect(() => parseArtboard(file('<div/>', '<script data-dc-script></script>'))).toThrow(/omit it entirely/)
  })

  it('accepts a logic class with no data-props', () => {
    const p = parseArtboard(file('<div/>', '<script data-dc-script>class Component extends DCLogic {}</script>'))
    expect(p.logic).toContain('DCLogic')
    expect(p.props).toEqual({})
  })

  it('decodes HTML entities before parsing data-props', () => {
    const p = parseArtboard(file('<div/>', `<script data-dc-script data-props='{"label":{"editor":"text","default":"Tom &#39;n&#39; Jerry &amp; Co"}}'>class Component extends DCLogic {}</script>`))
    expect(p.props.label.default).toBe("Tom 'n' Jerry & Co")
  })

  it('reports unparseable data-props with the reason', () => {
    expect(() => parseArtboard(file('<div/>', `<script data-dc-script data-props='{nope}'>class Component extends DCLogic {}</script>`)))
      .toThrow(/not valid JSON/)
  })

  it('extracts $preview and keeps it out of props', () => {
    const p = parseArtboard(file('<div/>', `<script data-dc-script data-props='{"$preview":{"width":390,"height":844},"a":{"editor":"text"}}'>class Component extends DCLogic {}</script>`))
    expect(p.preview).toEqual({ width: 390, height: 844 })
    expect(Object.keys(p.props)).toEqual(['a'])
  })

  it('keeps a null-editor prop in props but out of the tweak chips', () => {
    const p = parseArtboard(file('<div/>', `<script data-dc-script data-props='{"onPick":{"editor":null},"tint":{"editor":"color","default":"#fff"}}'>class Component extends DCLogic {}</script>`))
    expect(Object.keys(p.props).sort()).toEqual(['onPick', 'tint'])
    expect(tweakableProps(p.props)).toEqual(['tint'])
  })
})

describe('decodeAttribute', () => {
  it('decodes exactly the three that matter, and amp last', () => {
    expect(decodeAttribute('&#39;a&#39; &quot;b&quot; &amp;')).toBe(`'a' "b" &`)
    expect(decodeAttribute('&amp;#39;')).toBe('&#39;')
  })

  it('leaves raw UTF-8 alone', () => {
    expect(decodeAttribute('em—dash · árvíztűrő')).toBe('em—dash · árvíztűrő')
  })
})

describe('defaultProps', () => {
  it('collects declared defaults and omits props without one', () => {
    expect(defaultProps({ a: { default: 1 }, b: { editor: 'text' } })).toEqual({ a: 1 })
  })
})
