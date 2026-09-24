---
title: Autoaprendizaje y evolución de habilidades
description: Insights de uso, sugerencias de habilidades y candidatos con revisión humana.
---

**Para qué sirve.** Dos superficies. **Insights de autoaprendizaje** (`/self-learning`) informa tokens, coste y patrones. **Evolución de habilidades** (`/skill-evolution`) es la puerta humana para nuevas habilidades sugeridas. Nada escribe comportamiento hasta que apruebas.

**Rutas:** `/self-learning` (barra **Autoaprendizaje**), `/skill-evolution`.

## Cuándo usarlo

- Foto semanal de eficiencia.
- Trabajo repetido que debería ser una habilidad — sugerencia, no auto-escritura.
- Candidatos pendientes: **Aprobar** / **Rechazar**.
- El lado skill junto a [Forge](/docs/es/agents/forge/).

## Flujo típico

1. **Autoaprendizaje**: cuatro tarjetas, insights, patrones, sugerencias.
2. **Ejecutar análisis**.
3. **Evolución de habilidades**: Pending / Approved / Rejected.
4. Detalles, razonamiento, contenido — **Aprobar** (aún pasa el gate de auto-adopción) o **Rechazar**.
5. Comprueba [Habilidades](/docs/es/automation/skills/) → **Inventario**.

**Qué modelo las escribe.** Las sugerencias de Autoaprendizaje, las propuestas de descripción de Forge y la autoría de skills para Evolución de habilidades corren en el modelo en segundo plano de EYAS, con una llamada aislada cada una: el nivel de enrutado **Heartbeat** (primario, luego fallback), luego el valor por defecto de la instalación, luego los proveedores de API, luego las CLIs que pueden hacer llamadas aisladas. Nunca van a un proveedor que el gateway elija por su cuenta. Cuando ningún modelo cumple (por ejemplo, una instalación solo con Grok o solo con Kimi antes de verificar su aislamiento) o el presupuesto está en *stop*, no se hace ninguna llamada al modelo: Autoaprendizaje muestra sus frases de sugerencia genéricas, Forge conserva la propuesta de descripción concatenada y Evolución de habilidades escribe la plantilla `SKILL.md`. Los flags de Autonomía siguen controlando estas llamadas. Ver [Enrutado y presupuesto — El modelo en segundo plano](/docs/es/ai/routing-budget/#background-model).

## Relacionado

- [Habilidades](/docs/es/automation/skills/)
- [Forge](/docs/es/agents/forge/)
- [Autonomía](/docs/es/agents/autonomy/)
- [Proactivo](/docs/es/automation/proactive/)
