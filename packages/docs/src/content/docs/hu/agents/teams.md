---
title: Csapatok és delegálás
description: Kollégák, akikkel beszélsz, specialisták, akiket ők indítanak, és mikor jelenik meg még team-javaslat.
---

**Mire való.** **Kollégákkal** beszélsz (primary és team agentek). Szigorú szerepük van. Átadják a munkát másik kollégának, vagy **specialistát** indítanak a közös poolból — automatikusan, gyakran párhuzamosan. Team-javaslat kártya csak akkor jön, ha hiányzik egy specialista, te kértél csapatot, vagy a munka epic.

Ez együttműködés, nem God Mode (több modell ugyanazon a feladaton versenyez).

## Mikor használd

- A Personal Assistanttel vagy a System Engineerrel mint emberekkel akarsz beszélni, nem egy eldugott dropdownpal.
- Egy munkához több specialista kell egyszerre (`run_specialist` egy fordulóban).
- Git worktree-k, hogy a párhuzamos szerkesztők ne ütközzenek.
- Látható tervet akarsz **Approve**-olni, ha a specialista még nem létezik.

## Tipikus munkafolyamat

1. Nyiss egy **kollégát** a sidebar-ból (vagy válaszd új beszélgetésen).
2. Bízd meg. `handoff_to_colleague` vagy `run_specialist` — ne csinálja más szerep munkáját.
3. A specialista-futások al-beszélgetésként jelennek meg. A csapatmemória kártya nélkül is megy (implicit session).
4. Több specialista esetén **Team / Sub-conversations → Open Team Dashboard**.
5. **Team proposal** kártya `/team`, „csapat” vagy epic esetén — **Approve** vagy **Skip**.

## Fogalmak

| Fogalom | Jelentés |
|---------|----------|
| **Kolléga** | Primary vagy team agent, akit DM-elsz. Home-szál és SOUL. |
| **Specialista** | Szűk munkás. Közös pool. |
| **`run_specialist`** | Inline spawn, összefoglalóra vár. Zöld. Alias: `delegate_to_agent`. |
| **`handoff_to_colleague`** | A másik kolléga home-szála. Zöld. |
| **`assign_task`** | Aszinkron board-kártya. Zöld, ha a cél enabled. |
| **`propose_team`** | Kártya hiányzó szerepre / epicre / explicit kérésre. Sárga. |
| **Home-szál** | Kollégánként egy folytonos beszélgetés. |
| **Implicit work session** | Az első specialista-spawn hozza létre a team memoryhoz. |

## Worktree és verify

| Viselkedés | Mikor |
|------------|-------|
| **Git worktree** | Két vagy több író specialista implicit sessionben, illetve **complex** / **epic** team-javaslat — `.eyas-worktrees/` |
| **Verify parancsok** | Opcionális `agent.verifyCommands` — lásd [Konfiguráció](/docs/hu/deploy/configuration/) |

## Beszélgetésben

Lásd [Beszélgetések](/docs/hu/daily/conversations/).

## Beállítás

A varázsló két primary kollégát hoz létre. A **Team agents** további kollégákat ad. Specialisták sablonból vagy **Create Agent**. Később: Agentek.

## Kapcsolódó

- [Beszélgetések](/docs/hu/daily/conversations/)
- [Futtatások](/docs/hu/agents/runs/)
- [Agentek áttekintés](/docs/hu/agents/overview/)
