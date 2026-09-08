---
title: Kubernetes
description: Chart Helm de producción en deploy/k8s/helm/eyas — para un clúster.
---

**Para qué sirve.** Tercer camino: chart Helm para un clúster real. PVC para `data/`, Ingress, probes, secrets como objetos Kubernetes. Los YAML crudos arriba de `deploy/k8s/` son **legado** — en producción usa **Helm**.

## Cuándo usarlo

- Varias réplicas o clúster compartido (aun así **nunca** dos escritores en un SQLite).
- Ingress + StorageClass.
- Secretos desde un Secret de Kubernetes o External Secrets Operator.

## Flujo típico

1. K8s 1.28+, Helm 3.12+, imagen, Ingress, StorageClass.
2. Namespace `eyas`. Secret de **master key** (`eyas-master-key`) *antes* de `helm install`.
3. Pull-secret si el registro es privado. `helm install`.
4. Probes `/api/v1/health`. Abre el host de Ingress.

Guarda la master key en un gestor de contraseñas — perderla pierde el vault de secretos.

**Margen de memoria para una importación grande.** El límite por defecto del chart es 1Gi, que deja sitio para una importación de data-port: un archivo contenedor se mantiene en memoria mientras se renderiza cada unidad de su interior, y cuánto cuesta eso depende del archivo — unas tres veces su tamaño para una transcripción de una línea por turno, siete o más para una exportación de chat analizada entera. Una exportación de chat de 90 MB llega cerca de 900 MiB residentes: cabe en 1Gi, pero por poco; el YAML de arranque heredado en la raíz de `deploy/k8s/` pone 512Mi y no la aguanta. El pico lo marca tu archivo individual más grande, no el tamaño del escaneo, así que sube el límite antes de importar algo mayor. Véase [Importación y exportación de datos](/docs/es/admin/data-port/).

## Relacionado

- [Nativo](/docs/es/deploy/native/)
- [Docker](/docs/es/deploy/docker/)
- [Configuración](/docs/es/deploy/configuration/)
- [Ingress (túnel Cloudflare)](/docs/es/admin/ingress/)
