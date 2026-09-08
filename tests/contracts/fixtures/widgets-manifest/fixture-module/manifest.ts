// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fixture only — not a real module. Mirrors the real
// src/modules/mission-control pattern: the module object lives in
// manifest.ts (spread into index.ts's exported module, e.g.
// `mission-control/index.ts:91`: `...missionControlManifest`), and it — not
// index.ts — is where `frontend.widgets` actually lives. Proves the scraper
// reads a top-level module's manifest.ts, not just index.ts.

export const fixtureManifest = {
  id: 'fixture-module',
  frontend: {
    widgets: [{ id: 'fixture-module.manifest-widget', titleKey: 'fixture.title' }],
  },
}
