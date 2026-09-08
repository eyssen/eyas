---
title: hopbogh Daqmey
description: latlh De'wI'mey EYAS ghoSlaH (SSH, WebSocket, Tailscale) — ghoqwI'pu' juHvamDaq neH Qapbe'.
---

**Qu' 'oH.** hopbogh Daqmey latlh De'wI'mey tetlh 'oH, EYAS Dochvam ghoSlaHbogh. pong, juH, rar Segh Daqon — ghoqwI'pu' juHvamvo' Qu' QapmeH, motlh SSH. yIn **online**, **offline** pagh **unknown**. navvam tetlh 'oH; AI bej mI' ghobe', ghop (De'wI'/CLI rar) ghobe'.

## ghorgh yIlo'

- ghoqwI' latlh juHDaq ra' QapnIS, DochvamDaq neHbe'.
- **SSH**, **WebSocket** pagh **Tailscale** De'wI' Dachel.
- Qav tu' poH Dalegh, pagh pong / juH / teq DachoH.
- Hub SSH invoke DapoQ (Qaw' patmey botlu', ra'chu'chugh neH) — SSH Daq API 'oH, navvamDaq yoS ghobe'.

## motlh mIw

1. tlhop **SeHmey** ghom **pat chen** → **Nodes** (`/nodes`) yIpoSmoH.
2. **Daq yIchel**.
3. **pong** (Daq `my-node`), **juH** (Daq `192.168.1.100:3100`), **Segh** (**SSH**, **WebSocket** pagh **Tailscale**).
4. **toD**. nav Dotlh qIn 'ej Segh Degh nargh.
5. ghItlh jan pong, juH, Segh choH. Qaw' jan Daq teq.

chIm: *hopbogh Daq SeHlu'be'*. toDpu'DI' juH font-mono, tu'lu'chugh **Qav tu'**.

## laHmey

nav Hoch **pong**, Dotlh qIn, **Segh** Degh, **juH**, 'ej **Qav tu'** poH tu'lu'chugh 'ang.

nguv: **online** (SuD), **offline** (Doq), **unknown** (Hurgh SuD). Daq chu' **offline** tagh, tu'lu'lu'pa'.

ja'chuq **Segh**: **SSH**, **WebSocket**, **Tailscale**. Form laH tetlh Suqbe'; tetlh ghoqwI'pu'vaD laHmey toDlaHtaH.

SSH Daqmey Hub ra'wI' lo'taHvIS invoke (`POST`). `rm -f` / `rm -r`, `mkfs`, `dd if=`, fork Qaw' patmey botlu' — `forceDestructive` teHchugh neH. SSH-be' Seghmey invoke « chenbe' » jatlh. naw' peghmey (pong, pegh pagh pegh qon) invoke porgh pagh toDlu'bogh SeHvo' ghoS — qonbe'lu'.

WebSocket Tailscale je naDev tetlh + yIn; invoke yoS tu'lu'be'.

## mIwmey 'ej SeHwI'mey

<h2 id="add-node">Daq yIchel / yIchoH</h2>

| SeHwI' | Del |
|--------|-----|
| **Daq yIchel** | chen ja'chuq |
| Daq mI' | woS Degh, wa' tu'lu'chugh |
| **pong** | nuv pong. Daq `my-node` |
| **juH** | Daq. Daq `192.168.1.100:3100` |
| **Segh** | **SSH**, **WebSocket** pagh **Tailscale** |
| **toD** / **toDtaH…** | qon (pong pagh juH chImchugh QapHa') |
| ghItlh jan | **Daq yIchoH** — mIwmey rap |
| Qaw' jan | Daq Qaw' |

<h2 id="health">yIn</h2>

| SeHwI' | Del |
|--------|-----|
| Dotlh qIn | **online** / **offline** / **unknown** |
| Segh Degh | rar Segh navDaq |
| **Qav tu'** | poH, tetlh Daq tu'ta' |

## latlh

- [SeHmey Del](/docs/tlh/admin/settings/)
- [ghopmey](/docs/tlh/admin/hands/)
- [Qum chu'](/docs/tlh/admin/notifications/)
- [chelmeH janmey](/docs/tlh/admin/extensions/)
- [Ingress](/docs/tlh/admin/ingress/)
- [AI bej 'ej vum](/docs/tlh/admin/observability/)
- [peghmey](/docs/tlh/admin/secrets/)
