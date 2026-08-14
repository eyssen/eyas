---
title: Kubernetes
description: Manifests and Helm under deploy/k8s.
---

See repo `deploy/k8s/README.md` and Helm chart `deploy/k8s/helm/eyas/`.

Typical values: image, `EYAS_PORT`, PVC for data, secrets for keys, Ingress, probes on `/api/v1/health` or `/web/health` as configured.
