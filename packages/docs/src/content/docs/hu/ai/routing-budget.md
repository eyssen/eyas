---
title: Routing és költségkeret
description: Auto-routing szintek, fallbackek, költési limitek és agentenkénti modell-hozzárendelés.
---

**Mire való.** A routing azt dönti el, *melyik* modell válaszol. A költségkeret azt, *mennyit* költesz, mielőtt az EYAS figyelmeztet, olcsóbbra vált vagy hard-stopol. A modell-hozzárendelés a beépített agentek default modelljét rögzíti a setup után. Együtt tartják a több-provideres példányt attól, hogy mindig a drága modellt használja, vagy csendben elfogyjon a pénz.

**Útvonal:** `/providers` → **Routing szintek** és **Költségkeret**. Modell-hozzárendelés: Beállítások → **Modell-hozzárendelések** kártya.

## Mikor használd

- Auto-routing: olcsó modell triázsra, erősebb kódra.
- A primary felhő/CLI hullámzik — explicit **Fallback** (vagy opt-in auto-failover).
- Napi/heti/havi sapka, warn, downgrade, hard stop.
- A beépített agenteknek a varázsló után nincs modelljük — Beállítások.

## Tipikus folyamat

1. **Providerek** (`/providers`) → **Routing szintek**.
2. **Auto-routing Be**, ha üzenetelemzésből akarod a választást.
3. Szintenként **Elsődleges** provider+modell és opcionális **Tartalék**.
4. **Költségkeret**: **Napi / Heti / Havi**, majd **Figyelmeztetés / Visszaminősítés / Kemény stop**.
5. **Beállítások** → **Modell-hozzárendelések**, majd **Hozzárendelések mentése**.

## Funkciók

### Cross-provider auto-failover (opt-in)

Ha **auto-failover** be van kapcsolva (`EYAS_AUTO_FAILOVER=1`), az üres **Tartalék** slotokat kitöltheti egy második élő provider. **A már beállított tartalékot soha nem írja felül.**

Agent-szintű havi tokenkeret külön van (agent Konfiguráció).

## Mezők és vezérlők

<h2 id="auto-routing">Auto-routing</h2>

| Vezérlő | Jelentés |
|---------|----------|
| **Auto-routing Be/Ki** | Be: üzenetelemzésből választ |
| Hint | *Az EYAS automatikusan a megfelelő modellt választja az üzenet elemzése alapján* |

<h2 id="tiers">Routing szintek</h2>

| Szint | Tipikus használat |
|-------|-------------------|
| **Triázs** | Osztályozás / könnyű routing |
| **Gyors** | Olcsó, gyors válasz |
| **Standard** | Alap minőség |
| **Összetett** | Nehéz feladat |
| **Kódfuttatás** | Kódolós munka |
| **Heartbeat** | Proaktív hurkok (capture-modell jelölt is, ha a provider tényleg telepítve van és nem CLI) |
| **Beágyazás** | Vektor embedding |
| **Promptjavító** | Prompt enhancer agent |

| Mező | Jelentés |
|------|----------|
| **Provider választása…** | Szint elsődleges providere |
| **Modell választása…** | Elsődleges modell |
| **Tartalék / Nincs** | Ha az elsődleges elhasal |

<h2 id="budget">Költségkeret</h2>

| Mező | Jelentés |
|------|----------|
| **Napi / Heti / Havi** | Időszak sapkája (`korlátlan` ha üres/0) |
| **Figyelmeztetés** | Küszöb |
| **Visszaminősítés** | Olcsóbb modellekre |
| **Kemény stop** | További költés tiltása |

<h2 id="model-assignments">Modell-hozzárendelések (Beállítások)</h2>

A varázsló opcionális AI-modellek lépésének hitelesített pótlása (az a lépés a setup után zárt).

| Vezérlő | Jelentés |
|---------|----------|
| Agent név | Beépített / seed agent |
| Modell | **— nincs —** vagy engedélyezett provider modellje |
| **Hozzárendelések mentése** | PUT `/api/v1/model/agent-assignments` |

A kártya elrejtőzik, ha nincs seed agent vagy modell.

## Kapcsolódó

- [Providerek](/docs/hu/ai/providers/)
- [Agentek — tokenkeret](/docs/hu/agents/configure/)
- [Promptok](/docs/hu/ai/prompts/)
- [Proaktív](/docs/hu/automation/proactive/)
