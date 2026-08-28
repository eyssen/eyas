---
title: Kubernetes
description: Manifestes et Helm sous deploy/k8s.
---

Voir le `deploy/k8s/README.md` du dépôt et le chart Helm `deploy/k8s/helm/eyas/`.

Valeurs typiques : image, `EYAS_PORT`, PVC pour les données, secrets pour les clés, Ingress, sondes sur `/api/v1/health` ou `/web/health` selon la configuration.
