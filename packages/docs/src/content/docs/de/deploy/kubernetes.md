---
title: Kubernetes
description: Produktions-Helm-Chart unter deploy/k8s/helm/eyas — für ein Cluster.
---

**Wozu das da ist.** Dritter Install-Pfad: Helm-Chart für ein echtes Cluster (OCI OKE getestet). PVC für `data/`, Ingress, Probes, Secrets als K8s-Objekte. Die Roh-YAML oben in `deploy/k8s/` sind **Legacy** — produktiv das **Helm**-Chart.

## Wann du es brauchst

- Mehr Replicas oder geteiltes Cluster (trotzdem **nie** zwei Schreiber auf einer SQLite-Datei).
- Ingress + StorageClass (`oci-bv` auf OKE).
- Secrets aus K8s Secret oder External Secrets Operator.

## Typischer Ablauf

1. K8s 1.28+, Helm 3.12+, Image, Ingress-Controller, StorageClass.
2. Namespace `eyas`. **Master-Key-Secret** (`eyas-master-key`) *vor* `helm install`.
3. Pull-Secret wenn privat. `helm install` mit Values.
4. Probes `/api/v1/health`. Ingress-Host öffnen.

Master-Key in einem Passwortmanager halten — Verlust = Secrets-Vault weg.

## Verwandt

- [Native](/docs/de/deploy/native/)
- [Docker](/docs/de/deploy/docker/)
- [Konfiguration](/docs/de/deploy/configuration/)
- [Ingress (Cloudflare-Tunnel)](/docs/de/admin/ingress/)
