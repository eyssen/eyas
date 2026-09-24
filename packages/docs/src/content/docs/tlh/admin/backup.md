---
title: qon 'ej qaSqa'
description: naQ qaSqa' tev juHDaq, vaj Hur ngeH chaw' (S3/B2, FTP, Dropbox, SSH).
---

**nuq 'oH.** qon **naQ qaSqa' tev** jan chImvaD chenmoH: `data/` (DB, `master.key`, ghoqwI'pu', vault…), `config/`, `.env`, `version.json` — `backups/`be', tmpbe', Qap logbe'. **rap Qu' mI'**Daq qaSqa'. juH pa'; **wa'DIch** Daq ngeH.

**He:** `/backup`. nav: **qon**.

## ghorgh yIlo'

- tarball jan chIm **rap** EYAS mI'vaD.
- Hur: S3 rap (AWS, Backblaze B2, R2, MinIO), FTP/FTPS, Dropbox, SSH/SFTP.
- choH'egh qon yIn poQ.

## motlh mIw

1. **qon**.
2. chaw' **Daq yIchel**, Segh, SeH, pegh (ngoq pagh env pong), **ngeHvaD lo'**.
3. **qon yIchen**. tetlh: pong, mI', 'ab, **ngeHlu'** / **juH neH**.
4. qaSqa': tetlh mI' lIng, jan mev, `tar -xzf`, `chmod 600 data/master.key .env`, `eyas start`.

**CLI 'elmey qonDaq tu'lu'.** EYASvaD Grok CLI 'ej Kimi Code CLI 'elmey `data/cli-homes/grok-cli/.grok/auth.json` 'ej `data/cli-homes/kimi-cli/.kimi/credentials/kimi-code.json`Daq ghaHlu', vaj De' paq qon chaH ngaS. qon pegh ngoq rur yIqel, `master.key` rur. [nobwI'pu' — EYASvaD Grok Kimi je yI'el](/docs/tlh/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### qonDaq nuq ngaSlu'be'

| qonDaq tu'lu'be' | qatlh / nuq yIta' |
|------------------|-------------------|
| `backups/`, tmp, Qap pid 'ej log | chenqa'meH poQlu'be' |
| `data/cli-homes/*/sessions` bIngDaq CLI session pa'mey | woDlu'bogh CLI ja'chuq qonmey — EYAS taHqa'be' not (Hoch mIw pItlhDI' Qaw' EYAS je) |
| De' paq Hurbogh ja'chuq vum pa'mey | git clonevo' Qapbogh Hal lIngDaq, pagh `EYAS_WORKSPACES_DIR` cherlu'chugh, vum pa'mey `data/` Hur tu'lu' ([SeH — ja'chuq vum pa'mey](/docs/tlh/deploy/configuration/#conversation-workspaces)). ghoqwI' chenmoHbogh teywI'mey ratlh taH: ja'chuq chellu'bogh [ghItlhmey](/docs/tlh/knowledge/documents/)Daq cha'loghlu', 'ej chaH qonlu'. |
| `EYAS_DATA_DIR` vIHbogh De' paq | qon `<EYAS home>/data` neH ngaS. latlh DaqDaq `EYAS_DATA_DIR` 'oSchugh, paqvetlh — De' pa' 'ej qawHaq vault ngaSbogh — qonmeylIjDaq yIchel. |

## latlh

- [tagh](/docs/tlh/getting-started/)
- [pat choH](/docs/tlh/admin/settings/)
- [peghmey](/docs/tlh/admin/secrets/)
- [De' qem](/docs/tlh/admin/data-port/)
