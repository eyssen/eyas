---
title: juH lIng
description: Bun juHDaq — clone pagh lIngwI', vaj eyas start. qep'a' pagh VPS mach.
---

**nuq 'oH.** juH lIng wej He wa' (juH / Docker / Kubernetes). **juH** yIwIv Bun janDaq poQchugh, juH CLI (`claude`, `grok`, `kimi`) rap PATH, 'ej Doch mach. UI: **http://localhost:3100** — 3000be'.

[tagh](/docs/tlh/getting-started/).

## ghorgh yIlo'

- ghojmoH qep'a' pagh wa' VPS Bun 1.x (pagh Node 22+).
- juH CLI nobwI' tev Hutlh.
- qon qaSqa' `--version` rap lIngDaq.

## motlh mIw

1. Bun 1.x (pagh Node 22+).
2. `git clone` + `bun install` **pagh** `scripts/install.sh` / `install.ps1`.
3. `bin/` `PATH`Daq.
4. `./bin/eyas start` pagh `./bin/eyas serve`.
5. **http://localhost:3100**, [tagh ghojmoHwI'](/docs/tlh/setup-wizard/).

wa' tlhegh: `curl -fsSL https://raw.githubusercontent.com/eyssen/eyas/main/scripts/install.sh | bash`. pin: `--version 0.8.16-beta`.

### juHDaq Claude Code

EYAS rap PATHDaq Claude Code (`claude`) yIlIng, pagh naQ HeDaq `EYAS_CLAUDE_CODE_BIN` yIcher — launchd pagh systemd taghbogh Qu' PATH shelllIj PATH puS motlh. QapwI'vetlh 'ellu'ta'DI' neH nobwI' lo'laH (`claude auth status`). **Claude Code runtime** tlheghDaq 'Iv QapwI' Qap EYAS 'ang `eyas doctor`. [nobwI'pu' — Claude Code Qap](/docs/tlh/ai/providers/#claude-code-runtime).

### Hal lIngDaq vum pa'mey

git clonevo' Qapbogh Hal lIng checkoutvetlh qoDDaq De' paqDaj pol, vaj ja'chuq vum pa'mey lo'wI' ghun De' paqDaq ghoS (macOSDaq `~/Library/Application Support/eyas/<instance>/workspaces` rur). [SeH — ja'chuq vum pa'mey](/docs/tlh/deploy/configuration/#conversation-workspaces).

## latlh

- [Docker](/docs/tlh/deploy/docker/)
- [Kubernetes](/docs/tlh/deploy/kubernetes/)
- [CLI](/docs/tlh/deploy/cli/)
- [SeH](/docs/tlh/deploy/configuration/)
