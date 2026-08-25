// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Skill identity collides across roots (222 files → 220 ids today). Before this,
// readdir order decided the winner, which is filesystem-dependent. The ladder
// below makes it explicit and reproducible, and losers are recorded rather than
// silently overwritten. It also drives orphan detection: a bundled skill whose
// source file has vanished from a completed scan.
import { sql } from 'drizzle-orm'

export type SkillOrigin = { source: string; root: string; path: string }

const CORE_ROOT = 'config/skills'

/**
 * Every extension scan root MUST be built with this — never a bare directory
 * string. The 'ext:' prefix guarantees an extension's source_root can never
 * equal the literal CORE_ROOT, no matter what dataDir/installPath resolve to
 * (extensions/index.ts derives the directory from config, which is not under
 * this module's control). Two disjoint root namespaces "by construction"
 * beats "by convention": findOrphans() below only matches an EXACT rootId
 * string, so as long as core and extension roots can never produce the same
 * string, a core-root orphan sweep can never pick up an extension-sourced row.
 */
const EXTENSION_ROOT_PREFIX = 'ext:'
export function extensionRootId(dir: string): string {
  return `${EXTENSION_ROOT_PREFIX}${dir}`
}

export const SOURCE_RANK: Record<'user' | 'generated' | 'extension-bundled' | 'core-bundled', number> = {
  user: 40,
  generated: 30,
  'extension-bundled': 20,
  'core-bundled': 10,
}

/** Higher wins. */
export function originRank(o: SkillOrigin): number {
  if (o.source === 'user') return SOURCE_RANK.user
  if (o.source === 'generated') return SOURCE_RANK.generated
  if (o.source === 'bundled' && o.root !== CORE_ROOT) return SOURCE_RANK['extension-bundled'] // extension pack
  return SOURCE_RANK['core-bundled']
}

/** True when `candidate` should replace `incumbent`. Total and antisymmetric. */
export function wins(candidate: SkillOrigin, incumbent: SkillOrigin): boolean {
  const rc = originRank(candidate)
  const ri = originRank(incumbent)
  if (rc !== ri) return rc > ri
  if (candidate.root !== incumbent.root) return candidate.root < incumbent.root
  return candidate.path < incumbent.path
}

/**
 * Bundled skills in `rootId` whose source file was not seen by the scan that
 * started at `scanStartedAt` — i.e. the file has vanished since the last
 * completed scan. `user` and `generated` skills have no filesystem source to
 * go stale, so they are never candidates here (see the `source = 'bundled'`
 * filter) and can never be reported as orphaned.
 */
export function findOrphans(db: any, rootId: string, scanStartedAt: string): string[] {
  const rows = db.all(sql`SELECT id FROM skills
    WHERE source = 'bundled' AND source_root = ${rootId}
      AND (last_seen_at IS NULL OR last_seen_at < ${scanStartedAt})`) as any[]
  return rows.map((r) => r.id)
}

/**
 * Runs a directory scan and, only when it completed, follows it with orphan
 * detection. Orphan detection must NEVER run on an incomplete scan: a single
 * transient read error would otherwise leave every file the scan never reached
 * looking orphaned, which is a proposal to disable most of the inventory off
 * the back of one bad file.
 */
export async function runSkillScan(db: any, loader: any, dir: string, rootId: string) {
  const scanStartedAt = new Date().toISOString()
  const scan = await loader.loadFromDirectory(dir, rootId)
  if (!scan.complete) {
    return { ...scan, orphans: [] as string[], orphanDetectionSkipped: true }
  }
  return { ...scan, orphans: findOrphans(db, rootId, scanStartedAt), orphanDetectionSkipped: false }
}

export interface InventoryRow {
  id: string
  name: string
  category?: string
  source: string
  sourcePath?: string
  sourceRoot?: string
  enabled: boolean
  disabledReason?: string
  useCount: number
  lastUsedAt?: string
  createdAt: string
  shadowedSources: { path: string; root: string }[]
  isOrphan: boolean
  situational: boolean
}

/** A skill is situational when its category sits under one of these prefixes. */
const SITUATIONAL_PREFIXES = ['disaster-recovery', 'migration', 'incident']

export function buildInventory(db: any, orphanIds: string[] = []): InventoryRow[] {
  const orphans = new Set(orphanIds)
  const skills = db.all(sql`SELECT * FROM skills ORDER BY name`) as any[]
  const shadows = db.all(sql`SELECT skill_id, path, root FROM skill_shadowed_sources`) as any[]

  const bySkill = new Map<string, { path: string; root: string }[]>()
  for (const s of shadows) {
    const list = bySkill.get(s.skill_id) ?? []
    list.push({ path: s.path, root: s.root })
    bySkill.set(s.skill_id, list)
  }

  return skills.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category ?? undefined,
    source: r.source,
    sourcePath: r.source_path ?? undefined,
    sourceRoot: r.source_root ?? undefined,
    enabled: r.enabled === 1,
    disabledReason: r.disabled_reason ?? undefined,
    useCount: r.use_count ?? 0,
    lastUsedAt: r.last_used_at ?? undefined,
    createdAt: r.created_at,
    shadowedSources: bySkill.get(r.id) ?? [],
    isOrphan: orphans.has(r.id),
    situational: SITUATIONAL_PREFIXES.some((p) => (r.category ?? '').startsWith(p)),
  }))
}
