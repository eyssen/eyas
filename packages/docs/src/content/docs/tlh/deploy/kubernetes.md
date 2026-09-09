---
title: Kubernetes
description: Qu' Helm tetlh deploy/k8s/helm/eyas — ghomvaD.
---

**nuq 'oH.** wejDIch He: Helm tetlh teH ghomvaD. PVC `data/`vaD, Ingress, probes, peghmey K8s Doch. `deploy/k8s/` Dung YAML **qo' ngo'** — Qu'Daq **Helm** lo'.

## ghorgh yIlo'

- law' copy pagh ghom (reH **be'** cha' ghItlhwI' wa' SQLiteDaq).
- Ingress + StorageClass.
- peghmey K8s Secret pagh External Secrets Operatorvo'.

## motlh mIw

1. K8s 1.28+, Helm 3.12+, ghItlh, Ingress, StorageClass.
2. namespace `eyas`. **master key** Secret (`eyas-master-key`) `helm install` *pa'*.
3. pull-secret So'chugh. `helm install`.
4. probes `/api/v1/health`. Ingress jan yIpoS.

master key ngoq paqDaq yIpol — chIlchugh pegh vault chIl.

**tlhap tIn qawHaq yav.** chart motlh 'aqroS 1Gi 'oH, data-port tlhapvaD yap: boq teywI' wa' qawHaqDaq 'uchlu', qoDDaq Hoch 'ay' chenmoHlu'taHvIS; 'ej natlhDaj teywI' Segh Dep — Hoch tlheDvaD wa' tlhegh ghajbogh qonvaD tInDaj tlhoS wejlogh, naQ parbogh ja'chuq ngeHvaD Sochlogh pagh law'. 90 MB ja'chuq ngeH 'aqroS tlhoS 900 MiB ratlhtaH: 1Gi qoDDaq 'oH, 'ach yav puS; `deploy/k8s/` DungDaq ngugh starter YAML 512Mi cher, 'ej 'uchlaHbe'. teywI' tIn law' Hoch teywI' tIn puS 'aqroS cher, nej tInDaj ghobe'; vaj tIn law'bogh Doch tlhappa' 'aqroS yInIvmoH. [De' tlhap 'ej ngeH](/docs/tlh/admin/data-port/) yIlegh.

## latlh

- [juH](/docs/tlh/deploy/native/)
- [Docker](/docs/tlh/deploy/docker/)
- [SeH](/docs/tlh/deploy/configuration/)
- [Ingress (Cloudflare He)](/docs/tlh/admin/ingress/)
