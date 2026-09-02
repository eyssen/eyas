---
title: Kubernetes
description: Production Helm chart under deploy/k8s/helm/eyas — pick this for a cluster.
---

**What this is for.** Kubernetes is the third install path: a Helm chart for a real cluster. Use it when you need PVC-backed `data/`, an Ingress, probes, and secrets as Kubernetes objects. The raw YAML files at the top of `deploy/k8s/` are **legacy starters** — for any real deployment use **Helm** `deploy/k8s/helm/eyas/`.

See repo `deploy/k8s/README.md` and the chart `deploy/k8s/helm/eyas/`.

## When to use it

- More than one replica or a shared cluster (still **never** two writers on one SQLite file — see [multi-instance](/docs/en/deploy/multi-instance/)).
- You already run Ingress + a StorageClass.
- Secrets should come from a Kubernetes Secret or External Secrets Operator, not a file on disk.

## Typical workflow

1. Kubernetes 1.28+, Helm 3.12+, a reachable image, an Ingress controller, a StorageClass.
2. `kubectl create namespace eyas`. Create the **master key** Secret (`eyas-master-key` / `master-key`) *before* `helm install`.
3. Pull-secret if the registry is private. Set `image.pullSecrets` in values.
4. `helm install` the chart under `deploy/k8s/helm/eyas/` with your values (image, `EYAS_PORT`, PVC, Ingress).
5. Probes hit `/api/v1/health` (or `/web/health` as configured). Open the Ingress host.

## Features

Typical values: image, `EYAS_PORT`, PVC for data, secrets for keys, Ingress, probes on `/api/v1/health` or `/web/health` as configured.

Cloud-provider StorageClass names and load-balancer annotations go in *your* values file. Keep the master key in a password manager — losing it loses the secrets vault.

## Related

- [Native](/docs/en/deploy/native/)
- [Docker](/docs/en/deploy/docker/)
- [Configuration](/docs/en/deploy/configuration/)
- [Secrets](/docs/en/admin/secrets/)
- [Ingress (Cloudflare tunnel)](/docs/en/admin/ingress/) — different from cluster Ingress
