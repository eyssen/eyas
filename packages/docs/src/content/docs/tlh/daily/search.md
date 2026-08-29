---
title: nej
description: EYAS Hoch mo' nej — 'ej ghoqwI' 'Iv ngogh qach lo'laH 'e' yIngaQ.
---

**nuqmeH.** nej cha' Qu' ghaj. 'em nach nej Qu' nav, qawHaq, ghItlhmey, ngogh je Sam. **nej Halmey** qachmeyvam Dacher (wa' Odoo checkout mo' Hoch) 'ej Daindexqa'. ja'chuq 'ej Qu' ngaQmey ghoqwI' 'Iv qach nejlaH wuq — chovnatlhmey pegh ghombe'.

## ghorgh yIlo'

- teDwI', qawHaq ghItlh, pagh ghItlh DaSam, patHom DSovbe'taHvIS.
- Odoo checkout (pagh ngogh) yIchel, ghoqwI'pu' toD, QIjbe'.
- Odoo chovnatlh law' indexlu', 'ej ja'chuq pagh Qu'Daq 18c vs 18e yIngaQ.
- ghoqwI' `needsPin` nobpu' — mo'mey yIwIv, nejpa'.
- qach choHpu', indexqa' vIneH.

## motlh mIw

1. qach nejDaq yIghItlh (*Search across all indexed sources…*) pagh qaS yIpoSmoH — potlh nej 'oH.
2. qach chelmeH: **SeHmey → nej Halmey** ('em tlhegh **SeHmey**, **patHommey** ghom) — He `/search-sources`.
3. **Add Source** (wa' motlh ghoch, **Label** `18c`, **Family:** `odoo`) → **Create Source** → **Reindex** **ready** moj.
4. Qu'Daq **Default code sources** yIchu'; ja'chuq yIpoSmoH 'ej **Sources** nav rap ngaQ 'e' yIHon. Sam 'ej toD qachmeyvetlhDaq taH.

## pat

## potlh nej ('em nach / qaS pa')

| SeHwI' | QIj |
|--------|-----|
| **tetlhlu'bogh Hoch mo'meyDaq yInej…** | yu' pa' (shell nej nachDaq je) |
| qaS tetlh | Qu' nav, qawHaq, ghItlhmey, ngogh, …Daq qaS |
| **«…»vaD qaS pagh** | chIm qaS tetlh |
| **nejmeH yIghItlh…** | chIm yu' ghuH |
| bIng **M teDwI'meyDaq N qaS** | boS mI'mey |
| **teDwI' DaleghmeH qaS yIwIv** | chov pa' chIm Dotlh |
| **N tlheghmey** | qaS teDwI' chov 'a' |

---

## ngaj Suq (chay' Qap nej)

EYAS **naQ mu' (FTS / Orama)** **qawDaq veD** cosine tetlh je **RRF** (chegh patlh DuD) 'ej yu'vaD choHbogh potlhmey lo'taHvIS DuD. veDmey tu'lu'be'chugh, nej **FTS neHDaq jeS** (teH jeS — So'lu'bogh chIm qaS 'oHbe').

| laH | QIj |
|-----|-----|
| **tetlhDaq veD** | veD nobwI' (Ollama / OpenAI, …) SeHlu'DI' De'Hommey veDmey pol; taghDI' veDmey qa'lu' |
| **ngaS mI' qa'** | De'Hom ngaS choHbe'chugh nejqa' veDmey qa' |
| **toDmey** | ghoqwI'vaD `search_indexed` qaS taH `citationId` / `cite` (`[source:…]`) ngaS meH jang mo' toDlaH |
| **list_search_sources** | teHmey chenmoHpa' SeHlu'bogh mo'mey tetlhmeH ghoqwI' jan |
| **mo'Daq Qan** | tej / mo'vo' chenmoH meqvaD Suq toD poQ naQ chovwI' — teHmey ja'pa' nejnIS ghoqwI'pu' |

ngoghmey ghItlhmey je nej mo'mey bIngDaq tIchel meH ghoqwI'pu' **lI'** De'Daq Qu' Qan pagh qawbe'.

---

## nej mo'mey

**He:** `/search-sources` (SeHmey → nej mo'mey).  
bIng mu'tlhegh: *QIj 'ej naQ mu' nejvaD tetlhlu'bogh mo'mey tISeH.*

**Odoo chovnatlh law'vaD QaQ tIgh:** **lIng wa'DIch wa' mo'** yIcher (chov: Community 18, Enterprise 18, nIH chelmey). wa' He tetlhDaq Odoo chovnatlh law' yIvo'Qo'.

| De' / SeHwI' | QIj |
|--------------|-----|
| mI'mey **mo'mey / De'Hommey / boSmey** | tetlh chov |
| **mo' yIchel** / **chu' mo'** | chu' ghItlh |
| **pong** | cha' pong (chov: `Odoo 18 Community`) |
| **Segh** | mo' Segh (`code`, teDwI' pat, …) |
| **tetlhwI'** | He (`code` mo' SormeyvaD) |
| **Hemey / URL (wa' tlhegh wa')** | mo' wa'DIch **wa' naQ Sor** yIwIv |
| **pongHom** | chovnatlh law'vaD ran Qan ID (chov: `18c`, `18e`, `eyssen-erp`) |
| **chovnatlh** | nIH chovnatlh mu'tlhegh (chov: `18`, `19`) |
| **chovnatlh Segh** | nIH Segh (chov: `community`, `enterprise`) |
| **qorDu'** | Odoo lIngvaD **`odoo`** yIlo' meH chovnatlh law' Qan Hub Qap |
| **teq pa'mey / ghom** | wab yInargh (`i18n`, `static`, `node_modules`, …). qorDu' `odoo` chImchugh QaQ motlhmey Suq |
| **mo' yIchu'** | pol (nejqa'pa' Dotlh **vumbe'**) |
| **Qav tetlh** | Qav QaptaHbogh tetlh poH |
| **nejqa'** | **teDwI' ghommey**Daq nej (De'wI' jangtaH). mtime lo'taHvIS choHbe'bogh teDwI'mey narghlu'; veDmey ngaS mI' qa'. Dotlh **nejtaH** taHvIS De'Hom mI' yIntaH choH. botlu'bogh QaptaH veb nejqa'Daq che'egh. |
| **mo' yIQaw'** | mo' De'Hommey je yIteq |

tetlhDaq Deghmey **pongHom**, **chovnatlh**, **chovnatlh Segh**, **qorDu'**, Dotlh je cha'.

### tetlh Dotlh

| Dotlh | QIj |
|-------|-----|
| **vumbe'** | Qapbe' / tetlhlu'be' |
| **nejtaH** | nej/veD taH — ghommey polDI' De'Hom mI' DunchoH |
| **ghuH** | nejlaH |
| **Qagh** | Qav tetlh luj — QInmey / Hemey tIchov |

### env lIng (poQbe')

| env | QIj |
|-----|-----|
| `EYAS_ODOO_SOURCES_JSON` | wIvlu': `{ path, label?, version?, edition?, family?, name?, tags? }` JSON tetlh — Hutlhchugh taghDI' ponglu'bogh **vumbe'** mo'mey chenmoH |
| `EYAS_ODOO_SOURCE_PATHS` | `:` pagh `;` vo'lu'bogh Sormey; ram `odoo_search_*` 'ej pongHom mo'mey tu'lu'be'DI' lIngvaD lo'lu' |

lIng rInDI', nej mo'mey yIpoSmoH 'ej Hoch mo' **nejqa'**.

---

## chovnatlh law' Qan (nuq Sor lo'laH ghoqwI'?) {#multi-version-pin-which-tree-may-the-agent-use}

law' **odoo-qorDu'** mo'mey **ghuH**DI', EYAS So'taHvIS chovnatlhmey **DuDbe'**. wuq pong:

1. **nIH jan mu'mey** (`sourceIds`, `labels`, `version`, `edition` `search_indexed` / `odoo_search_*`Daq)
2. **ja'chuq Qan** — De' He → **mo'mey** qach (chov tetlh)
3. **Qu' motlh** — Qu'mey → **motlh ngogh mo'mey**
4. **Qu' Segh** `indexed_sources` (chenlu'chugh)
5. **jeS** — chovnatlh law' Suv ratlhchugh, janmey **`needsPin`** nob 'ej lo'laHbogh pongHommey tetlh

### ja'chuq → mo'mey qach

poS ja'chuqDaq, nIH **De' He**:

**qun | mo'mey | veb | teDwI'mey**

| SeHwI' | QIj |
|--------|-----|
| mo' tetlh | Hoch nej mo'mey (pong, pongHom, chovnatlh, Dotlh, He, De'Hom mI') |
| chov tetlh | ja'chuqvam lo'laHbogh mo'mey law' wIv |
| **Hoch yIwIv** / **pe' (autom)** | wa'logh Qan / pe' |
| **autom** Degh | Qan pagh — Qu' motlh / needsPin mIw |
| **N Qanlu'** | QaptaHbogh Qan mI' |
| **nej mo'mey yISeH →** | `/search-sources` He |

toDDI' ja'chuqDaq `searchContext: { sourceIds: […] }` choH. rap QanvaD `get_search_context` / `set_search_context` ra' ghoqwI'pu'.

### Qu' motlhmey

**Qu'mey** bIngDaq → Qu' yIchoH → **motlh ngogh mo'mey**:

| SeHwI' | QIj |
|--------|-----|
| chov tetlh | Qu'vamvaD motlh QanmeH nej mo'mey |
| **N wIvlu'** / **pe'** | Del 'ej motlhqa' |

autom lo'lu' 'e':

- Qu'vamDaq **ja'chuq Dachu'DI'** (Qu' nav pagh Qu' je chu' ja')
- ja'chuq **Qu'** De' **DachoHDI'** (wa' choHDaq nIH `searchContext` DangeHbe'chugh)

ja'chuqDaq **mo'mey** qachDaq reH nIHlaH.

### ghoqwI' janmey

| jan | meq |
|-----|-----|
| `list_search_sources` | mo'mey tetlh (pongHom, chovnatlh, qorDu', Hemey, Dotlh) |
| `get_search_context` | ja'chuqvamvaD QaptaHbogh Qan |
| `set_search_context` | Qan / pe' (`labels`, `sourceIds`, `version`, `edition`, pagh `clear: true`) |
| `search_indexed` | ngaj nej — Qan yaj; poQbe' wIvmey nIH |
| `odoo_search_model` / `field` / `xml_id` | **Qanlu'bogh Sormey** neHDaq juH Odoo nej; `[source:odoo-src:label:file:line]` toD |

---

## rarlu'

- [ja'chuqmey — mo'mey qach](/docs/tlh/daily/conversations/#context-rail-chatter)
- [Qu'mey — motlh ngogh mo'mey](/docs/tlh/daily/projects/#projects)
- [SeHmey — env](/docs/tlh/deploy/configuration/)
- [janmey — nej Odoo je](/docs/tlh/automation/tools/)
- [jIH Daq lIng Doch: De' pa'mey nejmeH](/docs/tlh/daily/home/)
