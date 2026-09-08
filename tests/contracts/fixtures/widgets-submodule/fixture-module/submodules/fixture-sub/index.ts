// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fixture only — mirrors the real submodule shape (e.g.
// src/modules/model/submodules/ollama/index.ts), which re-exports the
// manifest object from manifest.ts rather than declaring it inline. The
// scraper must find `frontend.widgets` in manifest.ts even though this file
// never mentions "widgets" itself.
export { fixtureManifest } from './manifest.js'
