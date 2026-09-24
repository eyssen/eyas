---
name: k8s-basics
description: Kubernetes fundamentals and client-node SDK usage
trigger_patterns:
  - "kubernetes"
  - "k8s"
  - "kubectl"
  - "kubernetes client"
  - "k8s api"
capabilities:
  - devops
version: "1.0.0"
sources:
  - name: "@kubernetes/client-node"
    url: https://github.com/kubernetes-client/javascript
    license: Apache-2.0
---
# Kubernetes Basics

## Core Resources
- **Pod**: smallest deployable unit, one or more containers
- **Deployment**: declarative pod management with rolling updates
- **Service**: stable network endpoint for pods (ClusterIP, NodePort, LoadBalancer)
- **ConfigMap / Secret**: configuration and sensitive data injection
- **Namespace**: logical isolation within a cluster

## Deployment Manifest
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: eyas
spec:
  replicas: 2
  selector:
    matchLabels:
      app: eyas
  template:
    metadata:
      labels:
        app: eyas
    spec:
      containers:
        - name: eyas
          image: ghcr.io/eyssen/eyas:1.0.0
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
```

## Programmatic Access with client-node
```typescript
import * as k8s from '@kubernetes/client-node';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const coreApi = kc.makeApiClient(k8s.CoreV1Api);
const pods = await coreApi.listNamespacedPod({ namespace: 'default' });
```

## Essential kubectl Commands
- `kubectl get pods -o wide` — list pods with node info
- `kubectl describe pod <name>` — detailed pod status and events
- `kubectl logs <pod> -f` — stream pod logs
- `kubectl exec -it <pod> -- sh` — shell into a container
- `kubectl apply -f manifest.yaml` — apply configuration
- `kubectl rollout status deployment/<name>` — watch rollout progress
