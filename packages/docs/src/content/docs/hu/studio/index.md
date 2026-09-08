---
title: Stúdió
description: Helyi motorok, amelyek írott HTML-ből videót készítenek. Nem a Média.
---

**Mire való.** A Stúdióban futnak a **helyi gyártómotorok** — az ügynök ír valamit (HTML, kompozíció), a gép fájlt renderel. Az első motor a Hyperframes. A [Média](/docs/hu/ai/media/) a másik sáv: hosted prompt→pixel (Magnific, Higgsfield, fal). Ne keverd.

**Útvonal:** `/studio`. Oldalsáv: **Tartalom → Stúdió**.

## Mikor használd

- Motion graphic, title card vagy explainer HTML-ből, determinisztikus MP4-gyel (Hyperframes).
- Nyers felvétel vágása transzkriptből (Video Use).
- **Nem** promptból generált videót akarsz — az a Média.
- Későbbi helyi motorok ide tartoznak, nem a Média alá.

## Tipikus folyamat

1. Nyisd a **Stúdiót** (`/studio`).
2. A **Hyperframes** kártyán Node.js 22+, FFmpeg és a CLI legyen rendben (npx-es figyelmeztetés még mehet).
3. Kérd a beszélgetésben. Az ügynök: `hyperframes_status`, `hyperframes_create`, `hyperframes_write`, `hyperframes_lint`, `hyperframes_render`.
4. Az MP4 a [Dokumentumokba](/docs/hu/knowledge/documents/) és arra a turnre kerül.

## Motorok

Minden kártya egy motor. Kész = minden blokkoló ellenőrzés zöld. Hiánynál orvosság — nincs csendes fallback. A Chromium sandbox soha nem kapcsol ki magától.

A szerződés: [Hyperframes](/docs/hu/studio/hyperframes/) és [Video Use](/docs/hu/studio/videouse/).

## Kapcsolódó

- [Hyperframes](/docs/hu/studio/hyperframes/)
- [Video Use](/docs/hu/studio/videouse/)
- [Média](/docs/hu/ai/media/)
- [Design tervek](/docs/hu/knowledge/design/)
- [Bővítmények](/docs/hu/admin/extensions/#recordly) — a Recordly (AGPL képernyőrögzítő) harmadik feles kísérő, nem Stúdió-motor
