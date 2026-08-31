// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fixture only — proves the scraper fails LOUDLY (throws) rather than
// silently reporting zero widgets when `widgets:` is declared in a shape it
// doesn't understand — here, built by a helper function instead of a plain
// array literal. A silent empty result would let a real module ship widgets
// this contract test can never see, which is the exact failure it exists to
// prevent.

function buildWidgets() {
  return [{ id: 'fixture-module.built-widget', titleKey: 'fixture.title' }]
}

export const fixtureManifest = {
  id: 'fixture-module',
  frontend: {
    widgets: buildWidgets(),
  },
}
