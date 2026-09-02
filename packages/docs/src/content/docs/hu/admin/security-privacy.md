---
title: Biztonság és adatvédelem
description: Biztonsági kapu, eseménystream, audit napló és PII-szkennelés — tool előtt és után.
---

**Mire való.** Három operátori felület. A **biztonsági kapu** a runtime policy, ami a toolhívást *mielőtt fut* engedélyezi, tiltja vagy eszkalálja. A **Biztonsági események** (`/security`) ezeknek a döntéseknek a streamje. Az **Napló** (`/audit`) a megváltoztathatatlan action log (opcionális rollback). Az **Adatvédelem** (`/privacy`) PII-szkennelés, sanitizálás és policy — ugyanaz a sanitiser, ami a tartós memória-capture-t a vault-írás *előtt* futtatja.

## Mikor használd

- Toolhívást tiltottak — checkpoint, kockázat, indok.
- Böngésző toolok ne érjenek privát/metadata hostot (SSRF).
- Autonómiát kapcsolsz, és látni akarod, mit eszkalál a kapu.
- PII szivárog-e logba, vault jegyzetbe, kimenő promptba.

## Tipikus folyamat

1. **Biztonság** (`/security`). Szűrő: döntés (**Engedélyez / Tilt / Eszkalál**), kockázat, tool, checkpoint.
2. **Napló** (`/audit`): ki mit, modul, eredmény (**siker / hiba / tiltva / visszavonva**), költség. Rollback megerősítéssel, ha van.
3. **Adatvédelem** (`/privacy`). Scan stat, majd **PII-szkenner tesztje** mintaszöveggel.
4. [Autonómia](/docs/hu/agents/autonomy/) + [Titkok](/docs/hu/admin/secrets/).
5. SSH más gépre: [Csomópontok](/docs/hu/admin/nodes/) — destruktív mintákhoz explicit force flag.

## Funkciók

| Terület | Útvonal / jelentés |
|---------|-------------------|
| **Biztonsági kapu** | Runtime policy veszélyes toolok előtt |
| **Biztonsági események** | `/security` stream |
| **Napló** | `/audit` action log |
| **Adatvédelem** | `/privacy` megőrzés / redakció |

### Böngésző SSRF

A böngésző toolok **privát / metadata** hostot blokkolnak. `browser_snapshot` kompakt accessibility fához; az index navigáció után érvénytelen. A headless profil az EYAS-é (`data/browser/profile`), a napi Chrome-profil tiltott (Chrome 136+). A `browser_evaluate` az oldalon fut, nem Node-ban. A `browser_totp` **sárga**: a seed a Titkokból/Keychainből jön, csak a rövid életű kód megy a `browser_fill`-be. Az action-cache JSON locatort tárol, titkot és kitöltött értéket nem. Az opcionális [Browser Use](/docs/hu/automation/browser-use/) sidecarek (ajánlott: agent-browser, `data/browser/agent-browser/profile`; régi Python CLI) soha nem kapcsolják ki a sandboxot, soha nem hívnak `chat`/AI Gateway-t, és soha nem a napi Chrome-profilra csatlakoznak.

### Olvasható git kattintás nélkül

A `git_status` és `git_diff` zöld. Ha a modell `run_command` / `Bash` argv-ja egyértelműen `git status` vagy `git diff` (nincs metachar, nincs `-C` / `--git-dir` / `--no-index`, nincs abszolút path), a gate ezekre a toolokra képezi, és **engedélyezi** — nincs jóváhagyási sor. A `git commit`, `git add`, `ls` és a metachar-os parancsok pirosak vagy elutasítottak. Lásd [Eszközök](/docs/hu/automation/tools/).

### Távoli csomópont SSH

Az SSH invoke őrzött parancs; **destruktív** minták force flaget kérnek. Nem-SSH típus not-implemented lehet.

### Memória-capture sanitizálás

A tartós jegyzeteket a privacy modul **lemezre írás előtt** sanitizálja, nem olvasáskor. A capture kapcsoló: `memory.capture.enabled` a `config/default.yaml`-ban (alap **be**). Lásd [Memória](/docs/hu/knowledge/memory/) és [GYIK](/docs/hu/reference/faq/).

## Mezők és vezérlők

<h2 id="security-events">Biztonsági események (`/security`)</h2>

Alcím: *Tool-végrehajtási döntések és biztonsági audit napló.*

| Vezérlő | Jelentés |
|---------|----------|
| Stat | **Összes esemény**, **Tiltási arány**, **Legtöbbet tiltott toolok** |
| Döntés | **Összes / Engedélyez / Tilt / Eszkalál** |
| Kockázat | **low / medium / high / critical** |
| Checkpoint | Szabad szöveg |
| Oszlopok | Időbélyeg, Tool, Döntés, Checkpoint, Kockázat, Agent, Indok |

<h2 id="audit">Napló (`/audit`)</h2>

Alcím: *Műveletnapló, snapshotok és rollback.*

| Vezérlő | Jelentés |
|---------|----------|
| Stat | Bejegyzések, művelet/nap, top modul, összköltség |
| Szűrők | Művelet, modul, tól, ig |
| Oszlopok | Időbélyeg, Felhasználó, Művelet, Modul, Cél, Eredmény, Költség |
| **Visszavonás** | Snapshotból (megerősítés) |

<h2 id="privacy">Adatvédelem (`/privacy`)</h2>

Alcím: *PII-szkennelés, adatvédelmi szabályok és megfelelés.*

| Vezérlő | Jelentés |
|---------|----------|
| Stat | **Összes scan**, **PII találat**, **PII típusok** |
| Szkenner teljesítmény | Szkenner, scankek, találatok |
| **PII-szkenner tesztje** | Szöveg beillesztése |
| Eredmény | **BLOKKOLVA** / **Helyire irányít** / nincs PII |
| **Sanitizált szöveg** | Redaktált előnézet |

## Kapcsolódó

- [Autonómia](/docs/hu/agents/autonomy/)
- [Felhasználók](/docs/hu/admin/users/)
- [Eszközök](/docs/hu/automation/tools/)
- [Megfigyelhetőség](/docs/hu/admin/observability/)
- [Csomópontok](/docs/hu/admin/nodes/)
- [Memória](/docs/hu/knowledge/memory/)
