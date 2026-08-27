// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** SPDX license identifier */
export type SpdxLicense = 'MIT' | 'Apache-2.0' | 'BSD-2-Clause' | 'BSD-3-Clause' | 'ISC' |
  'LGPL-3.0' | 'GPL-3.0' | 'GPL-2.0' | 'AGPL-3.0' | 'Unlicense' | 'CC-BY-SA-4.0' | string

/** Whether a license is MIT-compatible (bundleable) or requires user consent */
export type LicenseCompatibility = 'mit-compatible' | 'copyleft' | 'proprietary' | 'unknown'

/** Extension pack status */
export type ExtensionStatus = 'available' | 'installed' | 'update-available' | 'disabled'

/**
 * Extension install type:
 * - 'auto': EYAS downloads and installs automatically (copyleft/MIT packs)
 * - 'manual': User must download and install themselves (proprietary/restricted license)
 */
export type InstallType = 'auto' | 'manual'

/** A downloadable extension pack in the registry */
export interface ExtensionPack {
  /** Unique identifier (e.g. 'example-skills', 'data-science-tools') */
  id: string
  /** Display name */
  name: string
  /** Short description */
  description: string
  /** Version (semver) */
  version: string
  /** Author or organization */
  author: string
  /** SPDX license of the extension content */
  license: SpdxLicense
  /** License compatibility classification */
  licenseCompat: LicenseCompatibility
  /** Human-readable license notice shown before installation */
  licenseNotice: string
  /** How the extension is installed */
  installType: InstallType
  /** URL to download the extension archive (auto) or project homepage (manual) */
  downloadUrl: string
  /** SHA-256 checksum of the archive (auto only) */
  sha256?: string
  /** Number of skills in this pack (0 for manual — depends on user setup) */
  skillCount: number
  /** Skill categories included */
  categories: string[]
  /** Minimum EYAS version required */
  minEyasVersion?: string
  /** Icon URL or emoji */
  icon?: string
  /** Tags for search/filtering */
  tags?: string[]
  /** Setup instructions for manual extensions (markdown) */
  setupGuide?: string
}

/** Installed extension record (persisted in DB) */
export interface InstalledExtension {
  /** Extension pack ID */
  id: string
  /** Version installed */
  version: string
  /** When the license was accepted */
  licenseAcceptedAt: string
  /** When installed */
  installedAt: string
  /** When last updated */
  updatedAt: string
  /** Whether the extension is currently enabled */
  enabled: boolean
  /** Installation path (relative to data/extensions/) */
  installPath: string
}
