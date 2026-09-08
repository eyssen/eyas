// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fixture only — mirrors the real mission-control/index.ts, which spreads
// `...missionControlManifest` into its exported module rather than declaring
// `frontend` inline. This file never mentions "widgets" itself.
import { fixtureManifest } from './manifest.js'

export const fixtureModule = {
  ...fixtureManifest,
}
