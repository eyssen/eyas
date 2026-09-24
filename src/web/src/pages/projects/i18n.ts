import { registerBundle, t, tOr } from '@/i18n'
import { ApiError } from '@/lib/api'
import en from './locales/en.json'
import hu from './locales/hu.json'
import de from './locales/de.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import tlh from './locales/tlh.json'

registerBundle({ en, hu, de, es, fr, tlh })

export { t, tOr }

/** Display name for a seed project type; falls back to the stored name. */
export function seedTypeName(id: string, fallback: string): string {
  return tOr(`projects.types.seed.${id}.name`, fallback)
}

/** Short seed-type blurb for the types list. Empty when the type is not a known seed. */
export function seedTypeDescription(id: string): string {
  return tOr(`projects.types.seed.${id}.description`, '')
}

/**
 * Why the server refused a folder (tools/working-directories.ts
 * FOLDER_ERROR_CODES). One key family, projects.folders.error.<code>, for
 * every folder editor: projects, project types and a conversation's Folders.
 */
export const FOLDER_ERROR_CODES = [
  'home',
  'providerHome',
  'vault',
  'eyasData',
  'sensitive',
  'otherWorkspace',
  'containsEyasData',
  'containsProviderHome',
  'containsVault',
  'notAbsolute',
  'notFound',
  'notDirectory',
] as const

export type FolderErrorCode = (typeof FOLDER_ERROR_CODES)[number]

function isFolderErrorCode(code: unknown): code is FolderErrorCode {
  return typeof code === 'string' && (FOLDER_ERROR_CODES as readonly string[]).includes(code)
}

/**
 * The message for a failed folder save: a refused folder in the active
 * language (with the folder's path and, for a contains* refusal, the
 * protected place found inside it), otherwise the server's own message,
 * otherwise `fallback`.
 */
export function folderErrorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError && isFolderErrorCode(err.code)) {
    const path = typeof err.details?.path === 'string' ? err.details.path : ''
    const found = typeof err.details?.found === 'string' ? err.details.found : ''
    return t(`projects.folders.error.${err.code}`, { path, found })
  }
  return err instanceof Error && err.message ? err.message : fallback
}
