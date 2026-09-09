---
title: Távoli csomópontok
description: Más gépek, amelyeket az EYAS elér (SSH, WebSocket, Tailscale), hogy az ágensek ne csak ezen a dobozon dolgozzanak.
---

**Mire való.** A Távoli csomópontok azoknak a gépeknek a leltára, amelyeket ez az EYAS-példány elér. Nevet, hostot és kapcsolattípust regisztrálsz, hogy az ágensek ne csak ezen a dobozon fussanak — jellemzően SSH-n. Az állapot **online**, **offline** vagy **unknown**. Ez a lap a nyilvántartás; nem Observability-telemetria és nem Kéz (asztali/CLI párosítás).

## Mikor használd

- Az ágensnek másik hoston kell parancsot futtatnia, nem csak ezen a példányon.
- **SSH**, **WebSocket** vagy **Tailscale** gépet adsz hozzá.
- Látni akarod, mikor látták utoljára a csomópontot, vagy átnevezni / áthelyezni / törölni.
- Őrzött SSH invoke kell (destruktív minták force nélkül tiltva) — ez SSH-csomópontok API-ja, nem gomb ezen a lapon.

## Tipikus munkafolyamat

1. Nyisd az oldalsáv **Beállítások** csoport **Infrastruktúra** → **Csomópontok** (`/nodes`).
2. **Csomópont hozzáadása**.
3. **Név** (helyőrző `my-node`), **Kiszolgáló** (helyőrző `192.168.1.100:3100`), **Típus** (**SSH**, **WebSocket** vagy **Tailscale**).
4. **Mentés**. A kártya állapotponttal és típussal jelenik meg.
5. A ceruza nevet, hostot, típust szerkeszt. A kuka töröl.

Üres: *Nincs beállított távoli csomópont*. Mentés után a host monoszóközben, és ha van, **Utoljára látva**.

## Funkciók

Minden kártya: **Név**, állapotpont, **Típus** jelvény, **Kiszolgáló**, és **Utoljára látva**, ha van időbélyeg.

Színek: **online** (zöld), **offline** (piros), **unknown** (borostyán). Az új csomópont **offline**, amíg valami látottnak nem jelöli.

A párbeszéd **Típus**a **SSH**, **WebSocket** vagy **Tailscale**. Az űrlap nem kér képességlistát; a rekord ettől még tárolhat képességeket az ágenseknek.

Az SSH-csomópontok őrzött végrehajtón keresztül hívhatók (`POST` invoke). Az `rm -f` / `rm -r`, `mkfs`, `dd if=` és fork bomb minták elutasítva, hacsak a `forceDestructive` nem igaz. Nem-SSH típusok invoke-ra „nincs implementálva”. A hitelesítés (felhasználó, jelszó vagy privát kulcs) a hívás törzséből vagy a tárolt configból jön — soha nem naplózva.

A WebSocket és Tailscale ezen a lapon leltár + állapot; nincs invoke gomb.

## Mezők és vezérlők

<h2 id="add-node">Csomópont hozzáadása / szerkesztése</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Csomópont hozzáadása** | Létrehozó párbeszéd |
| Csomópontszám | Fejlécjelvény, ha van legalább egy |
| **Név** | Embernek szóló címke. Helyőrző `my-node` |
| **Kiszolgáló** | Cím. Helyőrző `192.168.1.100:3100` |
| **Típus** | **SSH**, **WebSocket** vagy **Tailscale** |
| **Mentés** / **Mentés…** | Rögzítés (üres név vagy hostnál tiltva) |
| Ceruza | **Csomópont szerkesztése** — ugyanazok a mezők |
| Kuka | Csomópont törlése |

<h2 id="health">Állapot</h2>

| Vezérlő | Jelentés |
|---------|----------|
| Állapotpont | **online** / **offline** / **unknown** |
| Típus jelvény | Kapcsolattípus a kártyán |
| **Utoljára látva** | Időbélyeg, amikor a nyilvántartás utoljára látottnak jelölte |

## Kapcsolódó

- [Beállítások áttekintés](/docs/hu/admin/settings/)
- [Kezek](/docs/hu/admin/hands/)
- [Értesítések](/docs/hu/admin/notifications/)
- [Bővítmények](/docs/hu/admin/extensions/)
- [Ingress](/docs/hu/admin/ingress/)
- [Observability és ops](/docs/hu/admin/observability/)
- [Titkok](/docs/hu/admin/secrets/)
