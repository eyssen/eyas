---
title: Kubernetes
description: Chart Helm de producción en deploy/k8s/helm/eyas — para un clúster.
---

**Para qué sirve.** Tercer camino: chart Helm para un clúster real (probado en OCI OKE). PVC para `data/`, Ingress, probes, secrets como objetos Kubernetes. Los YAML crudos arriba de `deploy/k8s/` son **legado** — en producción usa **Helm**.

## Cuándo usarlo

- Varias réplicas o clúster compartido (aun así **nunca** dos escritores en un SQLite).
- Ingress + StorageClass (`oci-bv` en OKE).
- Secretos desde un Secret de Kubernetes o External Secrets Operator.

## Flujo típico

1. K8s 1.28+, Helm 3.12+, imagen, Ingress, StorageClass.
2. Namespace `eyas`. Secret de **master key** (`eyas-master-key`) *antes* de `helm install`.
3. Pull-secret si el registro es privado. `helm install`.
4. Probes `/api/v1/health`. Abre el host de Ingress.

Guarda la master key en un gestor de contraseñas — perderla pierde el vault de secretos.

## Relacionado

- [Nativo](/docs/es/deploy/native/)
- [Docker](/docs/es/deploy/docker/)
- [Configuración](/docs/es/deploy/configuration/)
- [Ingress (túnel Cloudflare)](/docs/es/admin/ingress/)
