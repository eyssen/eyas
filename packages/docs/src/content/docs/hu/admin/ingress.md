---
title: Ingress alagút
description: Távoli elérés Cloudflare tunnelön keresztül.
---

**Útvonal:** `/ingress`.

Az Ingress egy **Cloudflare Tunnel**-t (`cloudflared`) indít, így az EYAS a helyi hálózaton kívülről is elérhető, bejövő port nyitása nélkül.

| Vezérlő | Jelentés |
|---------|----------|
| **Állapot** | Csatlakozva / nincs kapcsolat; nyilvános URL, ha az alagút él |
| **Indítás / Leállítás** | A `cloudflared` indítása vagy leállítása |
| **Tunnel token** | A Cloudflare Zero Trust tunnel tokenje — **Beállítások mentése** a vaultba teszi |
| **Hostname** | A tunnelhez a Cloudflare-ben beállított nyilvános név (pl. `eyas.pelda.hu`) |
| **Beállítások mentése** | Hosztnév + token tartósan. Indítás a mentett tokent használja, ha a mező üres |

## Előfeltételek

1. Telepítsd a [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)-et, és legyen a `PATH`-on.
2. Hozz létre alagutat: [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create** → Cloudflared.
3. A tunnel megnyitása után a **Configure / Install connector** parancsból csak az `eyJ…` részt másold (a `--token` után). Nem a tunnel neve, nem a UUID.
4. A tunnel **Hostname routes** fülén add hozzá a nyilvános nevet (pl. `jarvis-krisz.eyssen.ai`) → szolgáltatás `http://127.0.0.1:3100`. Enélkül a Cloudflare Inactive marad, még ha a `cloudflared` fut is.

A token titok — inkább a Secrets vault vagy env változó, ne a shell előzmény.

## Kapcsolódó

- [Beállítások](/docs/hu/admin/settings/)
- [Secrettek](/docs/hu/admin/secrets/)
- [Observability és ops](/docs/hu/admin/observability/)
- [Biztonság](/docs/hu/admin/security-privacy/)
