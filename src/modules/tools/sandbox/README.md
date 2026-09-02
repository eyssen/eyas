# Docker Sandbox (Phase 3L)

Goose-inspired per-tool sandbox. When a tool's `sandboxMode` is `'docker'`, the
executor routes its invocation through this module, which wraps the call in an
ephemeral, resource-limited, network-restricted container.

## Security posture (defaults)

| Control | Default | Purpose |
|---|---|---|
| `--rm` | on | ephemeral container, no state leak between runs |
| `--network none` | on | no outbound traffic unless explicitly widened |
| `--memory` | 512 MiB | prevents OOM of the host |
| `--memory-swap` | equal to `--memory` | blocks swap-based bypass |
| `--cpus` | 1.0 | fair-share limit |
| `--pids-limit` | 256 | fork-bomb cap |
| `--read-only` | on | rootfs is immutable |
| `--tmpfs /tmp` | 64 MiB, noexec,nosuid | writable scratch without host exposure |
| `--cap-drop ALL` | on | drops CAP_NET_RAW, CAP_SYS_ADMIN, etc. |
| `--security-opt no-new-privileges` | on | blocks setuid escalation |
| Working dir mount | `ro` | host worktree visible but unwritable by default |
| Env allowlist | empty | no host env var leakage |
| UID/GID | host user | no root-in-container by default |

## Fallback behavior

`createDockerSandbox().isAvailable()` runs `docker --version` (and optionally
`docker info`). If either fails, the executor MUST fall back to
`sandboxMode === 'process'` and emit a WARN log — a missing docker binary
never crashes the process.

## Required docker permissions

The running user needs access to the docker socket
(`/var/run/docker.sock`), i.e. membership of the `docker` group on Linux, or
Docker Desktop running on macOS/Windows. Rootless docker is supported but
untested.

## Image

Default image: `ghcr.io/eyssen/eyas-sandbox:latest`. Override via
`DockerSandboxConfig.image` or the top-level `sandboxImage` config key.

The image is expected to be a minimal Alpine/Debian with common runtimes
(bash, python3, node) preinstalled. Building the image is out of scope for
this module — use `docker pull` or the image-manager's `ensureImage` helper.

## Integration with tool-executor

This module is pure infrastructure — it does not self-register with the
executor. Wiring is a one-line change to `tool-executor.ts` (deferred to a
follow-up session):

```ts
// tool-executor.ts — inside execute(), just before tool.execute(...)
if (tool.sandboxMode === 'docker' && sandbox) {
  // Assumes tool.execute was shaped as a shell-like command-runner; adapter
  // TBD in follow-up. For the initial wiring, only shell-style tools use
  // this path.
  const result = await sandbox.run(command, args, { workingDirectory: cwd })
  // translate DockerRunResult → ToolResult here
}
```

For now this module provides the sandbox primitive; the executor integration
PR will decide the exact tool → command mapping.

## Testing

Unit tests (`tests/modules/tools/sandbox/*-unit.test.ts`) run anywhere — they
mock `spawn` and exercise argument construction, env filtering, and output
truncation.

Integration tests (`*-integration.test.ts`) are skipped via
`it.skipIf(!dockerAvailable)` when the `docker` binary is missing. CI without
docker is green; CI with docker runs real containers.
