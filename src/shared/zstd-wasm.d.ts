// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Ambient types for the WASM zstd tier. The package's `exports` map has no
// `types` condition and TypeScript's bundler resolution does not pair its
// Node entry with the browser typings, so this declaration is what
// src/shared/zstd.ts compiles against (an ambient module wins over file
// resolution). The three signatures are the ones the Phase 0 spike exercised.
declare module '@bokuweb/zstd-wasm' {
  export function init(wasmPath?: string): Promise<void>
  export function compress(data: Uint8Array, level?: number): Uint8Array
  export function decompress(data: Uint8Array): Uint8Array
}
