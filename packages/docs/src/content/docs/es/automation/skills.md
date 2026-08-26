---
title: Skills
description: Catálogo de skills y puerta de auto-adopción.
---

**Ruta:** `/skills`. Create Skill · búsqueda · filtro All / Own / Bundled. Fuentes: Bundled, User, Generated, Own. Campos: name, trigger patterns, content.

### Skill de coding (ejemplo)

`coding/odoo/odoo-dev-chain` — desarrollo Odoo con `odoo_search_*` + file tools antes de escribir.

### Puerta de auto-adopción (skill curator)

Los skills generados/evolucionados **no se adoptan automáticamente** salvo que un snapshot reciente de benchmark privado cumpla el **pass ratio** y la **puntuación media** mínimos. Create/enable manual en la UI no se ve afectado.

### Inventario de skills y detector de skills muertas

La pestaña **Inventario** muestra, por skill: qué copia ganó, qué eclipsa, de dónde viene, cuánto se usó y si está habilitada. Con el mismo id de skill en varios sitios, gana un orden fijo — nunca el orden del sistema de archivos: **User > Generated > Integrada (extensión) > Integrada (EYAS)**; en empate, alfabéticamente primero por raíz de origen y luego por ruta. Las perdedoras no desaparecen: se muestran como "eclipsadas".

El detector **solo propone, nunca actúa**: un escaneo en segundo plano marca skills habilitadas como huérfanas (falta el archivo), eclipsadas, nunca usadas (0 usos, más de 90 días) o inactivas (180+ días sin uso) y presenta cada una como propuesta en la [cola de aprobación de autonomía](/docs/es/agents/autonomy/). **Deshabilita, nunca elimina** — y eso solo tras tu aprobación. Huérfana/eclipsada son hechos y se proponen de inmediato; nunca-usada/inactiva son inferencias y solo aplican a partir de 30 días de antigüedad, y tus propias skills (User) quedan exentas de ambas reglas basadas en tiempo.

## Relacionado

- [Herramientas](/docs/es/automation/tools/)
- [Self-learning](/docs/es/automation/self-learning/)
- [Autonomía](/docs/es/agents/autonomy/)
