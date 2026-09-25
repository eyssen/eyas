// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Security page: 'Memory outside EYAS'. What the memory-sovereignty policy
// protects on this server — other tools' memory, Obsidian vaults, the
// owner's extra paths, EYAS's own data — whether each switched-on CLI
// provider's own tools run in the kernel file sandbox, and the last 24 hours
// of refusals (GET /api/v1/security/memory-policy). The payload carries
// absolute host paths; the route is owner/admin only.

import type { ReactNode } from 'react'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'
import { FolderLock, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { t, tOr } from './i18n'

// ─── Response (mirrors MemoryPolicyReport in src/modules/security-gate/memory-policy-report.ts) ───

export interface MemoryPolicyFileSandbox {
  status: 'active' | 'unavailable' | 'unsupported'
  reason: string
  mode: 'auto' | 'required'
}

export interface MemoryPolicyResponse {
  policy: {
    dataDir: string
    databasePath: string | null
    workspacesRoot: string
    providerHomes: string[]
    foreignStores: Array<{ id: string; label: string; paths: string[]; present: boolean }>
    foreignMemoryPaths: Array<{ path: string; present: boolean }>
    ignoredForeignMemoryPaths: string[]
    detectedVaults: Array<{ path: string; source: 'registry' | 'marker' }>
  }
  sandbox: {
    mode: 'auto' | 'required'
    providers: Array<{ id: string; name: string; fileSandbox: MemoryPolicyFileSandbox | null }>
  }
  refusals: {
    windowHours: number
    memoryPathDenials: number
    unsandboxedEscalations: number
  }
}

/** Localized reasons a sandbox is missing (cli-runtime/sandbox KERNEL_SANDBOX_REASONS). */
const SANDBOX_REASON_KEYS: Record<string, string> = {
  'no-bwrap': 'security.memoryPolicy.sandboxReason.noBwrap',
  'no-socat': 'security.memoryPolicy.sandboxReason.noSocat',
  'bwrap-unusable': 'security.memoryPolicy.sandboxReason.bwrapUnusable',
  'unsupported-platform': 'security.memoryPolicy.sandboxReason.platform',
  'cli-has-none': 'security.memoryPolicy.sandboxReason.cli',
}

const SANDBOX_STATUS_KEYS: Record<MemoryPolicyFileSandbox['status'], string> = {
  active: 'security.memoryPolicy.sandboxActive',
  unavailable: 'security.memoryPolicy.sandboxUnavailable',
  unsupported: 'security.memoryPolicy.sandboxUnsupported',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function PathLine({ path, note }: { path: string; note?: string }) {
  return (
    <li className="text-xs">
      <span className="font-mono break-all">{path}</span>
      {note && <span className="text-muted-foreground"> — {note}</span>}
    </li>
  )
}

function Empty() {
  return <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.none')}</p>
}

function SandboxLine({ name, sandbox, mode }: { name: string; sandbox: MemoryPolicyFileSandbox | null; mode: 'auto' | 'required' }) {
  const status = sandbox?.status ?? 'unavailable'
  const active = status === 'active'
  // Required and missing: every turn with tools on this CLI is refused.
  const blocking = !active && mode === 'required'
  const Icon = active ? ShieldCheck : status === 'unsupported' ? ShieldOff : ShieldAlert
  const tone = active ? 'text-primary' : blocking ? 'text-destructive' : 'text-muted-foreground'
  const reasonKey = !active && sandbox ? SANDBOX_REASON_KEYS[sandbox.reason] : undefined
  return (
    <li className="text-xs space-y-0.5" data-testid="memory-policy-sandbox">
      <div className={`flex items-start gap-1.5 ${tone}`}>
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-medium text-foreground">{name}</span>: {t(SANDBOX_STATUS_KEYS[status])}
          {reasonKey && <> ({t(reasonKey)})</>}
        </span>
      </div>
      {blocking && <p className="text-destructive pl-5">{t('security.memoryPolicy.sandboxRequiredBlocked')}</p>}
      {!active && !blocking && <p className="text-muted-foreground pl-5">{t('security.memoryPolicy.sandboxUnavailableHint')}</p>}
    </li>
  )
}

export function MemoryPolicyCard() {
  const { data, error, isLoading } = useApi<MemoryPolicyResponse>('/security/memory-policy')

  return (
    <section className="glass-card p-4 mb-4 space-y-3" data-testid="memory-policy-card">
      <div>
        <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <FolderLock className="h-4 w-4" />
          {t('security.memoryPolicy.title')}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('security.memoryPolicy.hint')}</p>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.loading')}</p>}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t('security.memoryPolicy.loadError', { message: error.message })}
        </p>
      )}
      {data && <MemoryPolicyBody data={data} />}
    </section>
  )
}

function MemoryPolicyBody({ data }: { data: MemoryPolicyResponse }) {
  const { policy, sandbox, refusals } = data
  const present = policy.foreignStores.filter((s) => s.present)
  const absent = policy.foreignStores.length - present.length
  // Only Claude Code can ask to run a command outside its sandbox; in 'auto'
  // such a command waits for a human (the unsandboxed-shell approval).
  const canLeaveSandbox = sandbox.providers.some((p) => p.id === 'claude-code' && p.fileSandbox?.status === 'active')

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="text-[10px]" data-testid="memory-policy-denials">
          {t('security.memoryPolicy.denials24h')}: {refusals.memoryPathDenials.toLocaleString()}
        </Badge>
        <Badge variant="outline" className="text-[10px]" data-testid="memory-policy-escalations">
          {t('security.memoryPolicy.unsandboxedEscalations24h')}: {refusals.unsandboxedEscalations.toLocaleString()}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 min-w-0">
          <Section title={t('security.memoryPolicy.foreignStores')}>
            {present.length > 0 ? (
              <ul className="space-y-0.5">
                {present.map((s) => (
                  <li key={s.id} className="text-xs">
                    <span className="font-medium">{tOr(`security.memoryPolicy.store.${s.id}`, s.label)}</span>
                    {s.paths.map((p) => (
                      <span key={p} className="block font-mono break-all text-muted-foreground">{p}</span>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
            {absent > 0 && (
              <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.foreignStoresAbsent', { count: absent })}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.segmentRules')}</p>
          </Section>

          <Section title={t('security.memoryPolicy.vaults')}>
            {policy.detectedVaults.length > 0 ? (
              <ul className="space-y-0.5">
                {policy.detectedVaults.map((v) => (
                  <PathLine
                    key={v.path}
                    path={v.path}
                    note={t(v.source === 'registry' ? 'security.memoryPolicy.vaultSourceRegistry' : 'security.memoryPolicy.vaultSourceMarker')}
                  />
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Section>

          <Section title={t('security.memoryPolicy.extraPaths')}>
            {policy.foreignMemoryPaths.length + policy.ignoredForeignMemoryPaths.length > 0 ? (
              <ul className="space-y-0.5">
                {policy.foreignMemoryPaths.map((p) => (
                  <PathLine key={p.path} path={p.path} note={p.present ? undefined : t('security.memoryPolicy.notPresent')} />
                ))}
                {policy.ignoredForeignMemoryPaths.map((p) => (
                  <PathLine key={`ignored:${p}`} path={p} note={t('security.memoryPolicy.extraPathIgnored')} />
                ))}
              </ul>
            ) : (
              <Empty />
            )}
            <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.configHint')}</p>
          </Section>
        </div>

        <div className="space-y-3 min-w-0">
          <Section title={t('security.memoryPolicy.eyasData')}>
            <ul className="space-y-0.5">
              <PathLine path={policy.dataDir} />
              {policy.databasePath && <PathLine path={policy.databasePath} note={t('security.memoryPolicy.database')} />}
              {policy.providerHomes.map((p) => (
                <PathLine key={p} path={p} note={t('security.memoryPolicy.providerHomes')} />
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.eyasDataHint')}</p>
          </Section>

          <Section title={t('security.memoryPolicy.workspaces')}>
            <ul>
              <PathLine path={policy.workspacesRoot} />
            </ul>
            <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.workspacesHint')}</p>
          </Section>

          <Section title={t('security.memoryPolicy.sandbox')}>
            <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.sandboxMode', { mode: sandbox.mode })}</p>
            {sandbox.providers.length > 0 ? (
              <ul className="space-y-1">
                {sandbox.providers.map((p) => (
                  <SandboxLine key={p.id} name={p.name} sandbox={p.fileSandbox} mode={sandbox.mode} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.sandboxNoCli')}</p>
            )}
            {canLeaveSandbox && sandbox.mode === 'auto' && (
              <p className="text-xs text-muted-foreground">{t('security.memoryPolicy.sandboxAutoHint')}</p>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}
