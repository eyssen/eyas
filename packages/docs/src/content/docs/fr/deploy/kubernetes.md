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

**Marge mémoire pour un gros import.** La limite par défaut du chart est de 1Gi, ce qui laisse de la place à un import data-port : un fichier conteneur est tenu en mémoire pendant que chaque unité qu’il contient est rendue, et le coût dépend du fichier — environ trois fois sa taille pour une transcription à une ligne par tour, sept ou plus pour un export de conversation analysé d’un bloc. Un export de conversation de 90 Mo culmine près de 900 Mio résidents : cela tient dans 1Gi, mais de peu ; le YAML de démarrage hérité à la racine de `deploy/k8s/` fixe 512Mi et n’y suffit pas. Le pic suit votre plus gros fichier isolé, pas la taille du scan : relevez la limite avant d’importer plus gros. Voir [Import et export de données](/docs/fr/admin/data-port/).

## Voir aussi

- [Natif](/docs/fr/deploy/native/)
- [Docker](/docs/fr/deploy/docker/)
- [Configuration](/docs/fr/deploy/configuration/)
- [Ingress (tunnel Cloudflare)](/docs/fr/admin/ingress/)
