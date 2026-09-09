---
title: Kubernetes
description: Produkciós Helm chart a deploy/k8s/helm/eyas alatt — clusterhez.
---

**Mire való.** A Kubernetes a harmadik telepítési út: Helm chart valódi clusterre. PVC-s `data/`, Ingress, probe-ok, Secret objektumok. A `deploy/k8s/` tetején lévő nyers YAML **legacy starter** — élesben a **Helm** `deploy/k8s/helm/eyas/`.

Lásd `deploy/k8s/README.md` és a chart.

## Mikor használd

- Több replica vagy megosztott cluster (két író **soha** egy SQLite fájlon — [több példány](/docs/hu/deploy/multi-instance/)).
- Van Ingress + StorageClass.
- A titkok Kubernetes Secretből vagy External Secrets Operatorból jönnek.

## Tipikus folyamat

1. Kubernetes 1.28+, Helm 3.12+, elérhető image, Ingress controller, StorageClass.
2. `kubectl create namespace eyas`. **Master key** Secret (`eyas-master-key` / `master-key`) *a* `helm install` *előtt*.
3. Pull-secret privát registryhez. `image.pullSecrets` a valuesben.
4. `helm install` a charttal (image, `EYAS_PORT`, PVC, Ingress).
5. Probe: `/api/v1/health` (vagy `/web/health`). Ingress host.

## Funkciók

Tipikus values: image, `EYAS_PORT`, PVC, secret, Ingress, probe `/api/v1/health` vagy `/web/health`. A felhő-szolgáltató StorageClass-neve és load-balancer annotációi a *saját* values fájlba tartoznak. A master key jelszókezelőben maradjon — elvesztése a secrets vaultot viszi.

**Memória-tartalék nagy importhoz.** A chart alap limitje 1Gi, ami elég egy data-port importhoz: egy konténerfájl a memóriában marad, amíg a benne lévő összes egység renderelődik, és hogy ez mennyibe kerül, az a fájltól függ — a fordulónként egy soros átiratnál a méretének nagyjából háromszorosa, az egyben elemzett chat exportnál hétszerese vagy több. Egy 90 MB-os chat export csúcsa 900 MiB rezidens memória közelében van: még belefér az 1Gi-be, de nem sokkal; a `deploy/k8s/` tetején lévő régi starter YAML 512Mi-t állít, és ezt nem bírja el. A csúcsot a legnagyobb egyedi fájlod adja, nem a scan mérete, ezért ennél nagyobb előtt emeld meg a limitet. Lásd: [Adatimport és -export](/docs/hu/admin/data-port/).

## Kapcsolódó

- [Natív](/docs/hu/deploy/native/)
- [Docker](/docs/hu/deploy/docker/)
- [Konfiguráció](/docs/hu/deploy/configuration/)
- [Titkok](/docs/hu/admin/secrets/)
- [Ingress (Cloudflare alagút)](/docs/hu/admin/ingress/) — más, mint a cluster Ingress
