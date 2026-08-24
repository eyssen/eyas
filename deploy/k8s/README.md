# EYAS — Kubernetes Deployment

Production-ready Helm chart for deploying EYAS on Kubernetes, with first-class
support for **Oracle Cloud Infrastructure — Oracle Kubernetes Engine (OCI OKE)**.

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
        ├── values-oci-oke.yaml
        ├── templates/
        └── tests/
```

The raw manifests at the top of `deploy/k8s/` are legacy starter files. For any
real deployment use the **Helm chart** under `helm/eyas/`.

## Prerequisites

1. **Kubernetes 1.28+** cluster — tested on OCI OKE (Enhanced cluster type)
2. **Helm 3.12+** on your workstation
3. **Container image** pushed to a registry reachable from the cluster
   (OCI Container Registry / OCIR, GHCR, Docker Hub…)
4. **Ingress controller** installed — one of:
   - `ingress-nginx`
   - `oci-native-ingress-controller` (OKE native — recommended on OKE)
5. **StorageClass** for persistent volumes
   - On OCI OKE: `oci-bv` (default — Oracle Block Volume)
6. **External Secrets Operator** (optional, recommended) if you want to source
   secrets from OCI Vault instead of plain Kubernetes `Secret`s.

## One-time setup — what YOU must do before `helm install`

### 1. Create the namespace

```bash
kubectl create namespace eyas
```

### 2. Container registry pull secret

If pulling from a private registry (e.g. OCIR):

```bash
kubectl create secret docker-registry eyas-registry \
  --namespace eyas \
  --docker-server=<region>.ocir.io \
  --docker-username='<tenancy-namespace>/<user>' \
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

Keep the value somewhere safe (password manager, OCI Vault, 1Password…). If
this secret is lost, existing encrypted data cannot be decrypted.

### 4. Provider API keys (optional — only if using paid providers)

```bash
kubectl create secret generic eyas-provider-keys \
  --namespace eyas \
  --from-literal=anthropic-api-key="${ANTHROPIC_API_KEY}" \
  --from-literal=openai-api-key="${OPENAI_API_KEY}"
```

Reference them in values under `env.fromSecret` (see `values.yaml`).

## Install

### Default (any Kubernetes cluster)

```bash
helm install eyas deploy/k8s/helm/eyas \
  --namespace eyas \
  --set image.repository=<your-registry>/eyas \
  --set image.tag=0.8.12-beta
```

### OCI OKE

```bash
helm install eyas deploy/k8s/helm/eyas \
  --namespace eyas \
  -f deploy/k8s/helm/eyas/values-oci-oke.yaml \
  --set image.repository=<region>.ocir.io/<tenancy>/eyas \
  --set image.tag=0.8.12-beta \
  --set ingress.hosts[0].host=eyas.example.com
```

## Upgrade

```bash
helm upgrade eyas deploy/k8s/helm/eyas \
  --namespace eyas \
  -f deploy/k8s/helm/eyas/values-oci-oke.yaml \
  --set image.tag=0.8.12-beta
```

## Uninstall

```bash
helm uninstall eyas --namespace eyas
# PVCs are NOT deleted automatically:
kubectl delete pvc -n eyas -l app.kubernetes.io/instance=eyas
```

## Lint & dry-run

```bash
# Lint both values files
helm lint deploy/k8s/helm/eyas
helm lint deploy/k8s/helm/eyas -f deploy/k8s/helm/eyas/values-oci-oke.yaml

# Render locally to inspect:
helm template eyas deploy/k8s/helm/eyas \
  -f deploy/k8s/helm/eyas/values-oci-oke.yaml | less

# Server-side dry-run (requires a cluster):
helm template eyas deploy/k8s/helm/eyas \
  -f deploy/k8s/helm/eyas/values-oci-oke.yaml \
  | kubectl apply -f - --dry-run=server --namespace eyas
```

A helper script is also available:

```bash
scripts/lint-helm.sh
```

## OCI OKE notes

- **Storage**: default `storageClassName: oci-bv` creates an Oracle Block Volume
  (min 50Gi, PVC request is rounded up). On OKE the default filesystem is
  ext4 — OK for SQLite + Orama index.
- **LoadBalancer**: if `service.type=LoadBalancer`, use the flexible shape
  annotation in `values-oci-oke.yaml` to control min/max bandwidth and avoid
  the legacy fixed-shape billing surprise.
- **Ingress**: prefer `oci-native-ingress-controller` (installed as an OKE
  add-on) — it provisions an OCI Native Load Balancer with HTTP/2 and WAF
  hooks. If you don't have it, `ingress-nginx` works fine.
- **Node pool targeting**: set `nodeSelector` / `tolerations` in values if you
  have dedicated node pools (e.g. `node.kubernetes.io/eyas-workload=true`).
- **External Secrets Operator + OCI Vault**: ESO supports OCI Vault as of
  v0.9+. Enable `externalSecrets.enabled=true` in values and configure your
  `SecretStore` separately — the chart only renders the `ExternalSecret` CR.

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
