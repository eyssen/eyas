---
name: k8s-security
description: Kubernetes security — RBAC, Pod Security, secrets, and policies
trigger_patterns:
  - "k8s security"
  - "rbac"
  - "pod security"
  - "k8s secrets"
  - "kubernetes rbac"
capabilities:
  - devops
  - security
version: "1.0.0"
---
# Kubernetes Security

## RBAC (Role-Based Access Control)
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: eyas
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: eyas
subjects:
  - kind: ServiceAccount
    name: eyas-app
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

## Pod Security Standards
```yaml
# Restricted profile (most secure)
apiVersion: v1
kind: Namespace
metadata:
  name: eyas
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/warn: restricted
```

## Security Context
```yaml
spec:
  securityContext:
    runAsNonRoot: true
    fsGroup: 1000
  containers:
    - securityContext:
        runAsUser: 1000
        readOnlyRootFilesystem: true
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
```

## Secrets Management
- Kubernetes Secrets are base64-encoded, not encrypted at rest by default
- Enable encryption at rest with `EncryptionConfiguration`
- Use external secret operators (External Secrets, Sealed Secrets) for GitOps
- Mount secrets as files, not environment variables (less exposure in logs)

## Network Policies
- Default deny all ingress and egress
- Whitelist required communication paths explicitly
- Separate namespaces for different trust levels

## Service Account Best Practices
- Create dedicated service accounts per application
- Disable automounting of default service account token
- Use `automountServiceAccountToken: false` unless API access is needed
- Bind minimal permissions with Role (not ClusterRole) when possible

## Audit and Compliance
- Enable Kubernetes audit logging
- Use admission controllers (OPA Gatekeeper, Kyverno) for policy enforcement
- Regularly review RBAC permissions for over-privileged accounts
