---
title: Kubernetes
description: Qu' Helm tetlh deploy/k8s/helm/eyas — ghomvaD.
---

**nuq 'oH.** wejDIch He: Helm tetlh teH ghomvaD (OCI OKE chovlu'). PVC `data/`vaD, Ingress, probes, peghmey K8s Doch. `deploy/k8s/` Dung YAML **qo' ngo'** — Qu'Daq **Helm** lo'.

## ghorgh yIlo'

- law' copy pagh ghom (reH **be'** cha' ghItlhwI' wa' SQLiteDaq).
- Ingress + StorageClass (`oci-bv` OKEDaq).
- peghmey K8s Secret pagh External Secrets Operatorvo'.

## motlh mIw

1. K8s 1.28+, Helm 3.12+, ghItlh, Ingress, StorageClass.
2. namespace `eyas`. **master key** Secret (`eyas-master-key`) `helm install` *pa'*.
3. pull-secret So'chugh. `helm install`.
4. probes `/api/v1/health`. Ingress jan yIpoS.

master key ngoq paqDaq yIpol — chIlchugh pegh vault chIl.

## latlh

- [juH](/docs/tlh/deploy/native/)
- [Docker](/docs/tlh/deploy/docker/)
- [SeH](/docs/tlh/deploy/configuration/)
- [Ingress (Cloudflare He)](/docs/tlh/admin/ingress/)
