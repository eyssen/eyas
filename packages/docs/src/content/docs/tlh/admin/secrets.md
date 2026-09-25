---
title: peghmey 'ej API ngaQmey
description: So' vault nobwI'/He ngoqvaD, + jan API ngaQmey EYAS API vaD.
---

**nuq 'oH.** cha' pegh Segh. **peghmey** (`/secrets`) So' qach 'oH: nobwI' ngoq, He ngoq, qon Daq. logDaq pong narghbe'. **API ngaQmey** (`/api-keys`) *EYAS* ra', Anthropic ra'be'. tagh joH ngoq payload So'.

## ghorgh yIlo'

- nav ja' **API ngoq Hutlh**.
- He ngoq YAML/shell qunDaq yInbe'.
- CI EYAS ra' — ngoq wa'logh qol, latlh teq.
- juv **pat / lo'wI' / ghoqwI'**.

## motlh mIw

1. **peghmey** — juv Dech, **pegh yIchel**.
2. **API ngaQmey** — **API ngaQ yIchen**, jaj rIn chaw'.
3. DaH banner yIqol.
4. lo'be'bogh **teq**.

[nobwI'pu'](/docs/tlh/ai/providers/) 'ej [Hemey](/docs/tlh/communication/channels/) ngoq naDev ghoS. qon ngoq pong pagh env pong (`BACKUP_S3_ACCESS_KEY`). 2FA TOTP ngoq naDev je (pong `github-totp`, **System**) pagh macOS Keychain (`-s <pong>` / `eyas-totp-<pong>`). `browser_totp` jav mI' neH nob; `browser_fill` ghoS. ngoq nI' action cacheDaq qaw'be'. [Browser Use](/docs/tlh/automation/browser-use/).

Grok CLI 'elmeH qachDaq **API ngoq yIlo'** DawIvDI', Grok CLI API ngoq naDev `grok-cli-api-key` (**System**) ghaHlu'. Grok CLI QapmeyvaD neH ngeH EYAS, `XAI_API_KEY` rur; pongvetlh lo'taHvIS naDev DachelmoHlaH je, 'ej nobwI' nav **mej** Qaw'. [nobwI'pu' — EYASvaD Grok Kimi je yI'el](/docs/tlh/ai/providers/#sign-in-grok-and-kimi-for-eyas). Grok Kimi je De'wI' 'elmey pegh qachvamDaq tu'lu'be': EYAS CLI juHmeyDaq teywI'mey chaH.

## latlh

- [tagh — joH ngoq](/docs/tlh/setup-wizard/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
- [qon](/docs/tlh/admin/backup/)
- [Hemey](/docs/tlh/communication/channels/)
- [Browser Use](/docs/tlh/automation/browser-use/) (`browser_totp`)
