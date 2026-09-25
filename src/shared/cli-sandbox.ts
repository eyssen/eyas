// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The one marker of an approval that exists because a shell command asked to
// leave the kernel file sandbox (security.cliSandbox 'auto'). The security
// gate writes it into its reason; the approval queue in the web recognises it
// and explains, in the viewer's language, why a human is asked. Browser-safe:
// no Node imports.

/** Tag carried by every unsandboxed-shell reason (gate verdict, approval row, tool row). */
export const UNSANDBOXED_SHELL_REASON_TAG = '[unsandboxed-shell]'

/** The gate's reason for such a call: only a human may let it run. */
export const UNSANDBOXED_SHELL_REASON =
  `${UNSANDBOXED_SHELL_REASON_TAG} a shell command asked to run outside the kernel file sandbox — a human must approve`

/** True for a reason text written for a command that asked to leave the sandbox. */
export function isUnsandboxedShellReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.includes(UNSANDBOXED_SHELL_REASON_TAG)
}
