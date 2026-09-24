# EYAS — Kubernetes Deployment

Production-ready Helm chart for deploying EYAS on any Kubernetes 1.28+ cluster.
Cloud-provider overlays (load-balancer annotations, StorageClass names, managed
ingress) belong in the *instance* values file, not in this chart.

## Layout

```
deploy/k8s/
├── README.md                   # this file
├── configmap.yaml              # legacy raw manifest (kept for reference)
├── deployment.yaml             # legacy raw manifest (kept for reference)
├── ingress.yaml                # legacy raw manifest (kept for reference)
├── pvc.yaml                    # legacy raw manifest (kept for reference)
├── secret.yaml                 # legacy raw manifest (kept for reference)
├── service.yaml                # legacy raw manifest (kept for reference)
└── helm/
    └── eyas/                   # production Helm chart (use this)
        ├── Chart.yaml
        ├── values.yaml
        ├── templates/
        └── tests/
```

The raw manifests at the top of `deploy/k8s/` are legacy starter files. For any
real deployment use the **Helm chart** under `helm/eyas/`.

## Prerequisites

1. **Kubernetes 1.28+** cluster
2. **Helm 3.12+** on your workstation
3. **Container image** pushed to a registry reachable from the cluster
4. **Ingress controller** installed (e.g. `ingress-nginx`, Traefik)
5. **StorageClass** for persistent volumes (cluster default, or set
   `persistence.data.storageClass` in values)
6. **External Secrets Operator** (optional) if you want to source secrets from
   a cluster SecretStore instead of plain Kubernetes `Secret`s.

## One-time setup — what YOU must do before `helm install`

### 1. Create the namespace

```bash
kubectl create namespace eyas
```

### 2. Container registry pull secret

If pulling from a private registry:

```bash
kubectl create secret docker-registry eyas-registry \
  --namespace eyas \
  --docker-server=<registry-host> \
  --docker-username='<user>' \
  --docker-password='<auth-token>' \
  --docker-email='you@example.com'
```

Then set `image.pullSecrets[0].name=eyas-registry` in your values file.

### 3. Master key secret (REQUIRED)

EYAS encrypts on-disk secrets with a master key. You MUST create it before
installing the chart, or provide it via External Secrets Operator.

Generate a random 32-byte key and store it:

```bash
MASTER_KEY="$(openssl rand -base64 32)"
kubectl create secret generic eyas-master-key \
  --namespace eyas \
  --from-literal=master-key="${MASTER_KEY}"
```

Keep the value somewhere safe (password manager, 1Password…). If this secret
is lost, existing encrypted data cannot be decrypted.

### 4. Provider API keys (optional — only if using paid providers)

```bash
kubectl create secret generic eyas-provider-keys \
  --namespace eyas \
  --from-literal=anthropic-api-key="${ANTHROPIC_API_KEY}" \
  --from-literal=openai-api-key="${OPENAI_API_KEY}"
```

Reference them in values under `env.fromSecret` (see `values.yaml`).

## Install

```bash
helm install eyas deploy/k8s/helm/eyas \
  --namespace eyas \
  --set image.repository=<your-registry>/eyas \
  --set image.tag=0.8.15-beta
```

Pass a private values file (`-f your-values.yaml`) for Ingress host,
StorageClass, and any cloud-provider annotations.

## Upgrade

```bash
helm upgrade eyas deploy/k8s/helm/eyas \
  --namespace eyas \
  --set image.tag=0.8.15-beta
```

## Uninstall

```bash
helm uninstall eyas --namespace eyas
# PVCs are NOT deleted automatically:
kubectl delete pvc -n eyas -l app.kubernetes.io/instance=eyas
```

## Lint & dry-run

```bash
helm lint deploy/k8s/helm/eyas

# Render locally to inspect:
helm template eyas deploy/k8s/helm/eyas | less

# Server-side dry-run (requires a cluster):
helm template eyas deploy/k8s/helm/eyas \
  | kubectl apply -f - --dry-run=server --namespace eyas
```

A helper script is also available:

```bash
scripts/lint-helm.sh
```

## Notes

- **Storage**: leave `persistence.data.storageClass` empty to use the cluster
  default. Size the PVC for SQLite + the Orama index.
- **Service**: default is `ClusterIP`. Set `service.type=LoadBalancer` only if
  you need a cloud load balancer; put provider annotations in *your* values.
- **Ingress**: default class is `nginx`. Override `ingress.className` for the
  controller you actually run.
- **Node targeting**: set `nodeSelector` / `tolerations` in values if you have
  dedicated node pools.
- **External Secrets Operator**: enable `externalSecrets.enabled=true` and
  point `secretStoreRef` at a SecretStore you created separately — the chart
  only renders the `ExternalSecret` CR.

## Troubleshooting

```bash
# Pod not starting?
kubectl describe pod -n eyas -l app.kubernetes.io/name=eyas

# Check logs
kubectl logs -n eyas -l app.kubernetes.io/name=eyas --tail=200

# Health check from inside the cluster
kubectl port-forward -n eyas svc/eyas 3100:3100
curl http://localhost:3100/api/v1/health
```
