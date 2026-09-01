---
title: Kubernetes
description: Chart Helm de production sous deploy/k8s/helm/eyas — pour un cluster.
---

**À quoi ça sert.** Troisième chemin : chart Helm pour un vrai cluster. PVC pour `data/`, Ingress, probes, secrets en objets Kubernetes. Les YAML bruts en haut de `deploy/k8s/` sont **héritage** — en prod, utilise **Helm**.

## Quand l'utiliser

- Plusieurs réplicas ou cluster partagé (quand même **jamais** deux écrivains sur un SQLite).
- Ingress + StorageClass.
- Secrets depuis un Secret Kubernetes ou External Secrets Operator.

## Déroulement typique

1. K8s 1.28+, Helm 3.12+, image, Ingress, StorageClass.
2. Namespace `eyas`. Secret de **master key** (`eyas-master-key`) *avant* `helm install`.
3. Pull-secret si le registre est privé. `helm install`.
4. Probes `/api/v1/health`. Ouvre l’hôte Ingress.

Garde la master key dans un gestionnaire de mots de passe — la perdre perd le coffre de secrets.

## Voir aussi

- [Natif](/docs/fr/deploy/native/)
- [Docker](/docs/fr/deploy/docker/)
- [Configuration](/docs/fr/deploy/configuration/)
- [Ingress (tunnel Cloudflare)](/docs/fr/admin/ingress/)
