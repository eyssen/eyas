---
name: helm-charts
description: Helm chart creation, templating, and management
trigger_patterns:
  - "helm"
  - "helm chart"
  - "helm template"
  - "helm install"
  - "helm values"
capabilities:
  - devops
version: "1.0.0"
---
# Helm Charts

## Chart Structure
```
mychart/
  Chart.yaml          # metadata (name, version, appVersion)
  values.yaml         # default configuration values
  templates/
    deployment.yaml   # Kubernetes manifests with Go templates
    service.yaml
    ingress.yaml
    _helpers.tpl      # reusable template partials
    NOTES.txt         # post-install message
```

## Templating Basics
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "mychart.fullname" . }}
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
```

## Values Management
```yaml
# values.yaml (defaults)
replicaCount: 1
image:
  repository: ghcr.io/eyssen/eyas
  tag: "1.0.0"
resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

Override with: `helm install myapp ./mychart -f production-values.yaml --set replicaCount=3`

## Essential Commands
- `helm create mychart` — scaffold a new chart
- `helm template mychart ./mychart` — render templates locally
- `helm lint ./mychart` — validate chart structure
- `helm install myapp ./mychart -n namespace` — install
- `helm upgrade myapp ./mychart` — upgrade release
- `helm rollback myapp 1` — rollback to revision
- `helm list -A` — list all releases

## Best Practices
- Use `_helpers.tpl` for labels, names, and selectors
- Make every configurable value a `.Values` entry
- Use `helm template` to verify output before applying
- Version chart independently from app version
- Document all values in `values.yaml` with comments
