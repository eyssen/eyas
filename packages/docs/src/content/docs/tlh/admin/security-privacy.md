---
title: Hub 'ej pegh
description: Hub lojmIt, wanI' He, chov qun, PII nej — jan pa' 'ej jan 'em.
---

**nuq 'oH.** wej Daq. **Hub lojmIt** ra' chaw'/nIH/tlha' *Qappa'*. **Hub wanI'mey** (`/security`) He 'oH. **chov** (`/audit`) qun choHlaHbe'. **pegh** (`/privacy`) PII — rap sanitizer nI' qawHaq capture vault ghItlh *pa'* Qap.

## ghorgh yIlo'

- ra' nIH — checkpoint, QIH, Qatlh.
- Internet jan private/metadata jan ra'be' (SSRF). Headless profile EYAS `data/browser/profile` — Chrome jaj profile lo'Qo' (Chrome 136+). snapshot mI' jaHtaHvIS Hegh. `evaluate` jaj neH. `browser_totp` SuD (ngoq peghmey/Keychain; mI' `browser_fill`). action cache locator neH, peghbe'.
- SeH'egh chu' — lojmIt nuq tlha'.
- PII log/vault QIn/mej mu'tlheghDaq.

## motlh mIw

1. **Hub** (`/security`): Allow/Deny/Escalate.
2. **chov** (`/audit`): 'Iv, pat, rIn, Huch. rollback chaw'.
3. **pegh** (`/privacy`): De', **PII nejwI' yIchov**.
4. [SeH'egh](/docs/tlh/agents/autonomy/) + [peghmey](/docs/tlh/admin/secrets/).
5. SSH: [Nodes](/docs/tlh/admin/nodes/) — QIH pabmey force flag poQ.

capture chu': `memory.capture.enabled` (motlh **chu'**). [FAQ](/docs/tlh/reference/faq/).

Sovlu'bogh `git status` / `git diff` `run_command`/`Bash`vo' SuD, qIH Hutlh (metachar Hutlh, `-C`/`--git-dir` Hutlh). [janmey](/docs/tlh/automation/tools/).

## latlh

- [SeH'egh](/docs/tlh/agents/autonomy/)
- [lo'wI'pu'](/docs/tlh/admin/users/)
- [janmey](/docs/tlh/automation/tools/)
- [bejlaH](/docs/tlh/admin/observability/)
- [Nodes](/docs/tlh/admin/nodes/)
- [qawHaq](/docs/tlh/knowledge/memory/)
