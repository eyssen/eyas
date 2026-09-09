---
title: Kubernetes
description: Produktions-Helm-Chart unter deploy/k8s/helm/eyas — für ein Cluster.
---

**Wozu das da ist.** Dritter Install-Pfad: Helm-Chart für ein echtes Cluster. PVC für `data/`, Ingress, Probes, Secrets als K8s-Objekte. Die Roh-YAML oben in `deploy/k8s/` sind **Legacy** — produktiv das **Helm**-Chart.

## Wann du es brauchst

- Mehr Replicas oder geteiltes Cluster (trotzdem **nie** zwei Schreiber auf einer SQLite-Datei).
- Ingress + StorageClass.
- Secrets aus K8s Secret oder External Secrets Operator.

## Typischer Ablauf

1. K8s 1.28+, Helm 3.12+, Image, Ingress-Controller, StorageClass.
2. Namespace `eyas`. **Master-Key-Secret** (`eyas-master-key`) *vor* `helm install`.
3. Pull-Secret wenn privat. `helm install` mit Values.
4. Probes `/api/v1/health`. Ingress-Host öffnen.

Master-Key in einem Passwortmanager halten — Verlust = Secrets-Vault weg.

**Speicher-Spielraum für einen großen Import.** Das Default-Limit des Charts ist 1Gi und lässt Platz für einen Data-Port-Import: Eine Container-Datei wird im Speicher gehalten, während jede Einheit darin gerendert wird, und wie teuer das ist, hängt von der Datei ab — etwa das Dreifache ihrer Größe bei einem Transkript mit einer Zeile je Zug, das Siebenfache oder mehr bei einem als Ganzes geparsten Chat-Export. Ein 90-MB-Chat-Export erreicht fast 900 MiB resident, also innerhalb von 1Gi, aber nicht mit viel Luft; das Legacy-Starter-YAML oben in `deploy/k8s/` setzt 512Mi und schafft das nicht. Der Spitzenwert folgt deiner größten Einzeldatei, nicht dem Umfang des Scans — hebe das Limit also vor etwas Größerem an. Siehe [Datenimport & -export](/docs/de/admin/data-port/).

## Verwandt

- [Native](/docs/de/deploy/native/)
- [Docker](/docs/de/deploy/docker/)
- [Konfiguration](/docs/de/deploy/configuration/)
- [Ingress (Cloudflare-Tunnel)](/docs/de/admin/ingress/)
