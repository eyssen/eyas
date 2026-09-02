---
title: Video Use
description: Nyers felvétel vágása MP4-re a Stúdión keresztül. Először a transzkript. Nem a Média.
---

**Mire való.** A Video Use beemelt klipekből és egy EDL-ből MP4-et készít. Az EYAS a nyílt video-use kemény szabályait TypeScriptben valósítja meg (MIT). Nem vendoral librosa-t vagy Manimot.

## Követelmények

- FFmpeg és ffprobe a PATH-on
- Opcionális: ElevenLabs Scribe kulcs `videouse-elevenlabs-api-key` secretként vagy `ELEVENLABS_API_KEY`

Hiányzó FFmpeg: fail-closed. Hiányzó kulcs: figyelmeztetés — inventory és render megy.

## Ügynök toolok

`videouse_status`, `videouse_create`, `videouse_ingest`, `videouse_inventory`, `videouse_transcribe`, `videouse_pack`, `videouse_write`, `videouse_lint`, `videouse_render`, `videouse_list`.

Vágási stratégiát a userrel erősítsd meg, mielőtt range-eket írsz. Overlay: Hyperframes.

## Kapcsolódó

- [Stúdió](/docs/hu/studio/)
- [Hyperframes](/docs/hu/studio/hyperframes/)
- [Média](/docs/hu/ai/media/)
