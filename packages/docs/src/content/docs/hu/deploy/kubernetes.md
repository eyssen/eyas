---
title: Kubernetes
description: Produkciós Helm chart a deploy/k8s/helm/eyas alatt — clusterhez.
---

**Mire való.** A Kubernetes a harmadik telepítési út: Helm chart valódi clusterre (OCI OKE-n tesztelve). PVC-s `data/`, Ingress, probe-ok, Secret objektumok. A `deploy/k8s/` tetején lévő nyers YAML **legacy starter** — élesben a **Helm** `deploy/k8s/helm/eyas/`.

Lásd `deploy/k8s/README.md` és a chart.

## Mikor használd

- Több replica vagy megosztott cluster (két író **soha** egy SQLite fájlon — [több példány](/docs/hu/deploy/multi-instance/)).
- Van Ingress + StorageClass (`oci-bv` OKE-n).
- A titkok Kubernetes Secretből vagy External Secrets Operatorból jönnek.

## Tipikus folyamat

1. Kubernetes 1.28+, Helm 3.12+, elérhető image, Ingress controller, StorageClass.
2. `kubectl create namespace eyas`. **Master key** Secret (`eyas-master-key` / `master-key`) *a* `helm install` *előtt*.
3. Pull-secret privát registryhez. `image.pullSecrets` a valuesben.
4. `helm install` a charttal (image, `EYAS_PORT`, PVC, Ingress).
5. Probe: `/api/v1/health` (vagy `/web/health`). Ingress host.

## Funkciók

Tipikus values: image, `EYAS_PORT`, PVC, secret, Ingress, probe `/api/v1/health` vagy `/web/health`. OCI OKE: `values-oci-oke.yaml`. A master key jelszókezelőben maradjon — elvesztése a secrets vaultot viszi.

## Kapcsolódó

- [Natív](/docs/hu/deploy/native/)
- [Docker](/docs/hu/deploy/docker/)
- [Konfiguráció](/docs/hu/deploy/configuration/)
- [Titkok](/docs/hu/admin/secrets/)
- [Ingress (Cloudflare alagút)](/docs/hu/admin/ingress/) — más, mint a cluster Ingress
