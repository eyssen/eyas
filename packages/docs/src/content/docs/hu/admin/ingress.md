---
title: Ingress alagút
description: Ezt az EYAS-t a LAN-on kívülről Cloudflare Tunnelön — bejövő port nélkül.
---

**Mire való.** Az Ingress **Cloudflare Tunnel**t (`cloudflared`) indít, hogy telefon, másik iroda vagy webhook-provider elérje ezt a példányt anélkül, hogy a routeren portot nyitnál. Ez *ehhez a géphez* való távoli hozzáférés, nem [távoli csomópont](/docs/hu/admin/nodes/) (amire az agentek SSH-znak) és nem [Kéz](/docs/hu/admin/hands/).

**Útvonal:** `/ingress`. Menü: **Ingress**.

## Mikor használd

- `https://eyas.example.com` erre a laptopra/VPS-re port-forward nélkül.
- Telegram/WhatsApp/Teams webhooknak publikus HTTPS kell.
- Útközben is kell a UI, Cloudflare előtt.

## Tipikus folyamat

1. Telepítsd a [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)-et, maradjon `PATH`-on.
2. Alagút: [Zero Trust](https://one.dash.cloudflare.com/) → **Networks** → **Tunnels** → **Create** → Cloudflared.
3. Alagút → **Configure / Install connector**, csak az `eyJ…` token a `--token` után (nem a név vagy UUID).
4. Mutass az alagúttal ide (tipikusan `http://127.0.0.1:3100` — **3100**, nem 3000).
5. EYAS **Ingress**: **Alagút token** és **Hostnév**, **Beállítások mentése**, **Indítás**. A státusz a publikus URL-t mutatja, ha fent van.

## Funkciók

A token titok — inkább vault vagy env, mint shell history. Az **Indítás** az elmentett tokent használja, ha a mező üres.

## Mezők és vezérlők

| Vezérlő | Jelentés |
|---------|----------|
| **Státusz** | Kapcsolódva vagy nem; publikus URL ha fent |
| **Indítás / Leállítás** | `cloudflared` spawn / kill |
| **Alagút token** | Zero Trust token — **Beállítások mentése** a vaultba |
| **Hostnév** | A Cloudflare-en az alagúthoz kötött név |
| **Beállítások mentése** | Hostnév + token. Indítás üres mezővel a mentettet használja |

## Kapcsolódó

- [Beállítások](/docs/hu/admin/settings/)
- [Titkok](/docs/hu/admin/secrets/)
- [Megfigyelhetőség](/docs/hu/admin/observability/)
- [Biztonság](/docs/hu/admin/security-privacy/)
- [Csatornák](/docs/hu/communication/channels/) (webhook típusok)
- [Csomópontok](/docs/hu/admin/nodes/)
