// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { spliceArtboardBody, patchPropDefault, readPropDefaults, DcSpliceError } from '@modules/design/dc-splice'
import { parseArtboard } from '@modules/design/dc-template'

const file = (body: string, props?: string) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>body { margin: 0 } a { color: #b45309 }</style>
</helmet>
${body}
</x-dc>
${props ? `<script data-dc-script data-props='${props}'>
class Component extends DCLogic { renderVals() { return { accent: this.props.accent } } }
</script>` : ''}
</body>
</html>`

describe('spliceArtboardBody', () => {
  it('replaces the template and keeps the helmet', () => {
    const out = spliceArtboardBody(file('<p>old</p>'), '<h1>new</h1>')
    const parsed = parseArtboard(out)
    expect(parsed.template).toBe('<h1>new</h1>')
    expect(parsed.helmet).toContain('a { color: #b45309 }')
  })

  it('keeps the head marker and the logic script byte-for-byte', () => {
    const source = file('<p>old</p>', '{"accent":{"editor":"color","default":"#b45309"}}')
    const out = spliceArtboardBody(source, '<h1>new</h1>')
    expect(out).toContain('<script src="./support.js"></script>')
    expect(out).toContain('class Component extends DCLogic')
    expect(parseArtboard(out).props.accent.default).toBe('#b45309')
  })

  it('works on an artboard with no helmet', () => {
    const out = spliceArtboardBody('<x-dc><p>a</p></x-dc>', '<p>b</p>')
    expect(parseArtboard(out).template).toBe('<p>b</p>')
    expect(out).not.toContain('helmet')
  })

  it('refuses a file with no <x-dc>', () => {
    expect(() => spliceArtboardBody('<html><body>x</body></html>', '<p/>')).toThrow(DcSpliceError)
  })

  it('refuses an unclosed <x-dc>', () => {
    expect(() => spliceArtboardBody('<x-dc><p>a</p>', '<p>b</p>')).toThrow(/unclosed/)
  })

  it('refuses a template that closes <x-dc> early and would truncate the artboard', () => {
    // This still PARSES — into a truncated artboard with the rest sitting
    // outside the element. Only the round-trip comparison catches it.
    expect(() => spliceArtboardBody(file('<p>a</p>'), '<p>keep</p></x-dc><script>alert(1)</script>'))
      .toThrow(/does not read back/)
  })

  it('allows a nested <x-dc>, which round-trips and loses nothing', () => {
    // Odd, but consistent: the inner element is just an unknown tag to the
    // runtime and the file reads back as written. Refusing it would be
    // inventing a rule the format does not have.
    const out = spliceArtboardBody(file('<p>a</p>'), '<x-dc><p>nested</p>')
    expect(parseArtboard(out).template).toBe('<x-dc><p>nested</p>')
  })

  it('round-trips: splice what parseArtboard produced and get the same template', () => {
    const source = file('<div style="padding: 16px"><span>Label</span></div>')
    const parsed = parseArtboard(source)
    const out = spliceArtboardBody(source, parsed.template)
    expect(parseArtboard(out).template).toBe(parsed.template)
  })
})

describe('patchPropDefault', () => {
  const withProps = (props: string) => file('<p style="color: {{accent}}">x</p>', props)

  it('writes the value as the declared default and keeps the editor', () => {
    const out = patchPropDefault(withProps('{"accent":{"editor":"color","default":"#b45309"}}'), 'accent', '#0a2540')
    const parsed = parseArtboard(out)
    expect(parsed.props.accent.default).toBe('#0a2540')
    expect(parsed.props.accent.editor).toBe('color')
  })

  it('handles a non-string value', () => {
    const out = patchPropDefault(withProps('{"dense":{"editor":"boolean","default":false}}'), 'dense', true)
    expect(parseArtboard(out).props.dense.default).toBe(true)
  })

  it('re-encodes the entities data-props needs', () => {
    const out = patchPropDefault(withProps('{"label":{"editor":"text","default":"x"}}'), 'label', "Tom 'n' Jerry & Co")
    expect(out).toContain('&#39;')
    expect(out).toContain('&amp;')
    expect(parseArtboard(out).props.label.default).toBe("Tom 'n' Jerry & Co")
  })

  it('keeps the attribute single-quoted', () => {
    const out = patchPropDefault(withProps('{"accent":{"editor":"color","default":"#000000"}}'), 'accent', '#111111')
    expect(out).toMatch(/data-props='/)
  })

  it('refuses a prop the artboard does not declare', () => {
    expect(() => patchPropDefault(withProps('{"accent":{"editor":"color"}}'), 'ghost', 1)).toThrow(/no prop named/)
  })

  it('refuses an artboard with no data-props at all', () => {
    expect(() => patchPropDefault(file('<p>x</p>'), 'accent', 1)).toThrow(/declares no data-props/)
  })

  it('refuses unparseable data-props rather than corrupting it', () => {
    expect(() => patchPropDefault(withProps('{nope}'), 'accent', 1)).toThrow(/not valid JSON/)
  })

  it('leaves other props untouched', () => {
    const out = patchPropDefault(
      withProps('{"accent":{"editor":"color","default":"#000000"},"dense":{"editor":"boolean","default":false}}'),
      'accent', '#111111',
    )
    const parsed = parseArtboard(out)
    expect(parsed.props.dense.default).toBe(false)
    expect(parsed.props.accent.default).toBe('#111111')
  })
})

describe('readPropDefaults', () => {
  it('collects declared defaults and skips props without one', () => {
    const source = file('<p>x</p>', '{"a":{"editor":"text","default":"A"},"b":{"editor":"text"}}')
    expect(readPropDefaults(source)).toEqual({ a: 'A' })
  })

  it('returns an empty record for a static artboard', () => {
    expect(readPropDefaults(file('<p>x</p>'))).toEqual({})
  })
})
