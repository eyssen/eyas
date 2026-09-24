// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The kernel file sandbox row of a CLI provider panel: whether the CLI's own
// tools run inside the operating system's file sandbox on this server, why
// not, and what security.cliSandbox does about it
// (GET /api/v1/model/providers/:id → fileSandbox).

import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react'
import { t } from './i18n'

export interface FileSandboxInfo {
  status: 'active' | 'unavailable' | 'unsupported'
  reason: string
  mode: 'auto' | 'required'
}

/** Localized text of the reasons a sandbox is missing (cli-runtime/sandbox KERNEL_SANDBOX_REASONS). */
const REASON_KEYS: Record<string, string> = {
  'no-bwrap': 'providers.panel.fileSandbox.reasonNoBwrap',
  'no-socat': 'providers.panel.fileSandbox.reasonNoSocat',
  'bwrap-unusable': 'providers.panel.fileSandbox.reasonBwrapUnusable',
  'unsupported-platform': 'providers.panel.fileSandbox.reasonPlatform',
  'cli-has-none': 'providers.panel.fileSandbox.reasonCli',
}

/**
 * `canLeave`: the CLI can ask to run a command outside the sandbox (Claude
 * Code) — in 'auto' such a command always waits for a human's approval.
 */
export function FileSandboxRow({ sandbox, canLeave = false }: { sandbox: FileSandboxInfo; canLeave?: boolean }) {
  const active = sandbox.status === 'active'
  const Icon = active ? ShieldCheck : sandbox.status === 'unsupported' ? ShieldOff : ShieldAlert
  // Required and missing: every turn with tools on this CLI is refused.
  const blocking = !active && sandbox.mode === 'required'
  const tone = active ? 'text-primary' : blocking ? 'text-destructive' : 'text-muted-foreground'
  const reasonKey = active ? undefined : REASON_KEYS[sandbox.reason]

  return (
    <div className="space-y-1" data-testid="provider-file-sandbox">
      <span className="text-sm font-medium">{t('providers.panel.fileSandbox.label')}</span>
      <div className={`flex items-start gap-2 text-xs ${tone}`}>
        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          {t(`providers.panel.fileSandbox.${sandbox.status}`)}
          {reasonKey && <> ({t(reasonKey)})</>}
        </span>
      </div>
      {active && canLeave && sandbox.mode === 'auto' && (
        <p className="text-xs text-muted-foreground">{t('providers.panel.fileSandbox.autoHint')}</p>
      )}
      {sandbox.mode === 'required' && (
        <p className={`text-xs ${blocking ? 'text-destructive' : 'text-muted-foreground'}`}>
          {t('providers.panel.fileSandbox.required')}
        </p>
      )}
    </div>
  )
}
