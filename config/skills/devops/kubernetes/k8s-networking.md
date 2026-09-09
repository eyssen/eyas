---
name: k8s-networking
description: Kubernetes networking concepts — Services, Ingress, and NetworkPolicy
trigger_patterns:
  - "k8s network"
  - "kubernetes ingress"
  - "service type"
  - "network policy"
  - "k8s dns"
capabilities:
  - devops
version: "1.0.0"
---
# Kubernetes Networking

## Service Types
- **ClusterIP** (default): internal-only, accessible within the cluster
- **NodePort**: exposes on each node's IP at a static port (30000-32767)
- **LoadBalancer**: provisions external load balancer (cloud provider)
- **ExternalName**: CNAME alias to an external DNS name

## Service DNS
- Services are accessible at `<service>.<namespace>.svc.cluster.local`
- Within the same namespace: just `<service>` suffices
- Headless services (`clusterIP: None`): DNS returns pod IPs directly

## Ingress
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: eyas-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts: [eyas.example.com]
      secretName: eyas-tls
  rules:
    - host: eyas.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: eyas
                port:
                  number: 3000
```

## Network Policies
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  # No ingress/egress rules = deny all
```

Then selectively allow traffic with additional policies.

## OCI Load Balancer
```yaml
metadata:
  annotations:
    service.beta.kubernetes.io/oci-load-balancer-shape: "flexible"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-min: "10"
    service.beta.kubernetes.io/oci-load-balancer-shape-flex-max: "100"
```

## Best Practices
- Start with deny-all NetworkPolicy, add allow rules explicitly
- Use Ingress for HTTP(S) routing, LoadBalancer for TCP/UDP
- Enable TLS termination at the ingress controller
- Monitor network traffic with tools like Hubble (Cilium)
- Use service mesh (Istio, Linkerd) for mTLS between services
