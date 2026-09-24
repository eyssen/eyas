// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fixture only — not a real module. Proves the widget contract scraper
// (tests/contracts/widgets.contract.test.ts) sees a widget declared on a
// SubmoduleManifest's `frontend.widgets` (src/core/types.ts:222), and that it
// reads `manifest.ts` — the file real submodules (e.g.
// src/modules/model/submodules/ollama) actually put the manifest object in,
// re-exporting it from a slim `index.ts` shim rather than declaring it there.

export const fixtureManifest = {
  id: 'fixture-module.fixture-sub',
  frontend: {
    widgets: [{ id: 'fixture-module.example-widget', titleKey: 'fixture.title' }],
  },
}
